import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_BROWSER_TOOLS,
  ToolGuard,
  containsCnpj,
  isValidCnpj,
  parseSnapshotRefs,
  toolResultText,
} from './guard';

const P = 'mcp__playwright__';
const assets = path.resolve('/srv/worker/assets');

function guard() {
  return new ToolGuard({
    allowedTools: ['WebSearch', 'WebFetch', 'mcp__dashboard__save_item', ...ALLOWED_BROWSER_TOOLS],
    uploadDir: assets,
  });
}

const SNAPSHOT = `- generic [ref=e1]:
  - heading "Sign in" [level=1] [ref=e2]
  - textbox "Email or phone" [ref=e3]
  - textbox "Password" [ref=e4]
  - textbox "Enter the 6-digit code" [ref=e5]
  - textbox "First name" [active] [ref=e6]: John
  - button "Accept all cookies" [ref=e7] [cursor=pointer]
  - button "Reject non-essential" [ref=e8]
  - button "Submit application" [ref=e9]
  - textbox "CNPJ" [ref=e10]
  - button "Subscribe to Premium" [ref=e11]
  - checkbox "I'm not a robot" [ref=e12]
  - textbox [ref=e13]`;

function withPage() {
  const instance = guard();
  instance.noteToolResult(`${P}browser_snapshot`, { content: [{ type: 'text', text: SNAPSHOT }] });
  return instance;
}

describe('page snapshots', () => {
  it('maps refs to their real labels', () => {
    const refs = parseSnapshotRefs(SNAPSHOT);
    expect(refs.get('e4')).toBe('textbox "Password"');
    expect(refs.get('e6')).toBe('textbox "First name" : John');
    expect(refs.get('e13')).toBe('textbox');
  });

  it('reads text out of every tool result shape', () => {
    expect(toolResultText('plain')).toBe('plain');
    expect(
      toolResultText([
        { type: 'text', text: 'a' },
        { type: 'text', text: 'b' },
      ]),
    ).toBe('a\nb');
    expect(toolResultText({ content: [{ type: 'text', text: 'c' }] })).toBe('c');
    expect(toolResultText(null)).toBe('');
  });
});

describe('rule 1 - never type passwords, codes, card or ID numbers', () => {
  it('blocks typing into a password field, even when the bot describes it innocently', () => {
    const instance = withPage();
    const decision = instance.check(`${P}browser_type`, {
      element: 'the second text box',
      target: 'e4',
      text: 'hunter2',
    });
    expect(decision.allow).toBe(false);
  });

  it('blocks typing when only the description says password', () => {
    expect(
      guard().check(`${P}browser_type`, { element: 'Password field', target: 'e99', text: 'x' })
        .allow,
    ).toBe(false);
  });

  it('blocks a password selector', () => {
    expect(
      guard().check(`${P}browser_type`, { target: 'input[type="password"]', text: 'x' }).allow,
    ).toBe(false);
    expect(guard().check(`${P}browser_type`, { target: '#password', text: 'x' }).allow).toBe(false);
  });

  it('blocks one-time codes (OTP)', () => {
    expect(withPage().check(`${P}browser_type`, { target: 'e5', text: '123456' }).allow).toBe(
      false,
    );
    expect(
      guard().check(`${P}browser_type`, { element: 'OTP input', target: 'e1', text: '1' }).allow,
    ).toBe(false);
    for (const element of ['Verification code', 'Code we sent to your email', 'SMS code']) {
      expect(
        guard().check(`${P}browser_type`, { element, target: 'e1', text: '1' }).allow,
        element,
      ).toBe(false);
    }
    // ordinary fields that merely contain the word "code" stay usable
    for (const element of ['Postal code', 'Country code', 'Zip code']) {
      expect(
        guard().check(`${P}browser_type`, { element, target: 'e1', text: '80810' }).allow,
        element,
      ).toBe(true);
    }
  });

  it('blocks card numbers and CVV', () => {
    for (const element of ['Card number', 'CVV', 'Credit card', 'Security code']) {
      expect(
        guard().check(`${P}browser_type`, { element, target: 'e1', text: '4111' }).allow,
        element,
      ).toBe(false);
    }
  });

  it('blocks the CNPJ field', () => {
    expect(withPage().check(`${P}browser_type`, { target: 'e10', text: '1' }).allow).toBe(false);
  });

  it('blocks a real CNPJ typed into any field at all', () => {
    // 11.222.333/0001-81 is a well-known example with valid check digits
    expect(isValidCnpj('11222333000181')).toBe(true);
    expect(isValidCnpj('11222333000182')).toBe(false);
    expect(containsCnpj('Tax number 11.222.333/0001-81')).toBe(true);
    const decision = withPage().check(`${P}browser_type`, {
      element: 'Additional information',
      target: 'e6',
      text: 'Company 11.222.333/0001-81',
    });
    expect(decision.allow).toBe(false);
  });

  it('does not mistake a phone number for a CNPJ', () => {
    expect(containsCnpj('+55 41 99999-0000')).toBe(false);
    expect(
      withPage().check(`${P}browser_type`, { target: 'e6', text: '+55 41 99999-0000' }).allow,
    ).toBe(true);
  });

  it('blocks SSN and other government IDs', () => {
    for (const element of ['SSN', 'Social security number', 'CPF', 'Passport number', 'IBAN']) {
      expect(
        guard().check(`${P}browser_type`, { element, target: 'e1', text: '1' }).allow,
        element,
      ).toBe(false);
    }
  });

  it('blocks a form fill that contains a password field', () => {
    const decision = withPage().check(`${P}browser_fill_form`, {
      fields: [
        { name: 'First name', type: 'textbox', target: 'e6', value: 'John' },
        { name: 'Pass', type: 'textbox', target: 'e4', value: 'secret' },
      ],
    });
    expect(decision.allow).toBe(false);
  });

  it('blocks typing a secret key by key after clicking into a password field', () => {
    const instance = withPage();
    expect(instance.check(`${P}browser_click`, { target: 'e4' }).allow).toBe(true);
    expect(instance.check(`${P}browser_press_key`, { key: 'a' }).allow).toBe(false);
    // moving on to a normal field clears it
    expect(instance.check(`${P}browser_click`, { target: 'e6' }).allow).toBe(true);
    expect(instance.check(`${P}browser_press_key`, { key: 'a' }).allow).toBe(true);
  });

  it('lets a bot fill in ordinary fields', () => {
    const instance = withPage();
    expect(instance.check(`${P}browser_type`, { target: 'e6', text: 'John' }).allow).toBe(true);
    expect(instance.check(`${P}browser_type`, { target: 'e3', text: 'a@b.co' }).allow).toBe(true);
    expect(instance.check(`${P}browser_press_key`, { key: 'Enter' }).allow).toBe(true);
  });
});

describe('rule 2 - never pay', () => {
  it('blocks navigating to a checkout URL', () => {
    for (const url of [
      'https://shop.example.com/checkout/step-1',
      'https://example.com/billing',
      'https://example.com/account/payment-methods',
      'https://example.com/pay/123',
      'https://buy.stripe.com/abc',
      'https://www.paypal.com/signin',
    ]) {
      expect(guard().check(`${P}browser_navigate`, { url }).allow, url).toBe(false);
    }
  });

  it('blocks opening a checkout URL in a new tab', () => {
    expect(
      guard().check(`${P}browser_tabs`, { action: 'new', url: 'https://x.com/checkout' }).allow,
    ).toBe(false);
  });

  it('lets a bot open ordinary pages', () => {
    for (const url of [
      'https://www.linkedin.com/in/someone',
      'https://apply.workable.com/acme/j/123',
      'https://boards.greenhouse.io/acme/jobs/1',
    ]) {
      expect(guard().check(`${P}browser_navigate`, { url }).allow, url).toBe(true);
    }
  });

  it('blocks non-web addresses', () => {
    expect(guard().check(`${P}browser_navigate`, { url: 'file:///etc/passwd' }).allow).toBe(false);
    expect(guard().check(`${P}browser_navigate`, { url: 'javascript:alert(1)' }).allow).toBe(false);
  });

  it('blocks buttons that spend money', () => {
    expect(withPage().check(`${P}browser_click`, { target: 'e11' }).allow).toBe(false);
    for (const element of ['Buy connects', 'Pay now', 'Start free trial', 'Add payment method']) {
      expect(guard().check(`${P}browser_click`, { element, target: 'e1' }).allow, element).toBe(
        false,
      );
    }
  });
});

describe('rule 3 - never solve a CAPTCHA', () => {
  it('blocks clicking a bot check', () => {
    expect(withPage().check(`${P}browser_click`, { target: 'e12' }).allow).toBe(false);
    expect(
      guard().check(`${P}browser_click`, { element: 'reCAPTCHA checkbox', target: 'e1' }).allow,
    ).toBe(false);
  });
});

describe('rule 4 - never accept terms or consent banners', () => {
  it('blocks an accept-terms click, by label or by description', () => {
    expect(withPage().check(`${P}browser_click`, { target: 'e7' }).allow).toBe(false);
    for (const element of ['Accept terms', 'I agree', 'Accept all cookies', 'Agree and continue']) {
      expect(guard().check(`${P}browser_click`, { element, target: 'e1' }).allow, element).toBe(
        false,
      );
    }
  });

  it('allows rejecting non-essential cookies and submitting an application', () => {
    const instance = withPage();
    expect(instance.check(`${P}browser_click`, { target: 'e8' }).allow).toBe(true);
    expect(instance.check(`${P}browser_click`, { target: 'e9' }).allow).toBe(true);
  });
});

describe('tool allowlist', () => {
  it('refuses every tool that is not on the list', () => {
    for (const tool of [
      'Bash',
      'Write',
      'Edit',
      'Read',
      `${P}browser_evaluate`,
      `${P}browser_run_code_unsafe`,
      `${P}browser_cookie_get`,
      `${P}browser_set_storage_state`,
      'mcp__other__anything',
    ]) {
      expect(guard().check(tool, {}).allow, tool).toBe(false);
    }
  });

  it('refuses browser tools for a bot without a browser', () => {
    const noBrowser = new ToolGuard({ allowedTools: ['WebSearch'], uploadDir: null });
    expect(noBrowser.check(`${P}browser_navigate`, { url: 'https://example.com' }).allow).toBe(
      false,
    );
    expect(noBrowser.check('WebSearch', { query: 'jobs' }).allow).toBe(true);
  });

  it('never offers script or cookie tools', () => {
    for (const tool of ALLOWED_BROWSER_TOOLS) {
      expect(tool).not.toMatch(/evaluate|run_code|cookie|storage|route|network/);
    }
  });
});

describe('file uploads', () => {
  it('only uploads from the assets folder', () => {
    const instance = guard();
    expect(
      instance.check(`${P}browser_file_upload`, { paths: [path.join(assets, 'cv.pdf')] }).allow,
    ).toBe(true);
    expect(instance.check(`${P}browser_file_upload`, { paths: ['/etc/passwd'] }).allow).toBe(false);
    expect(
      instance.check(`${P}browser_file_upload`, { paths: [path.join(assets, '..', '.env')] }).allow,
    ).toBe(false);
  });

  it('refuses uploads for bots that have no assets folder', () => {
    const instance = new ToolGuard({ allowedTools: ALLOWED_BROWSER_TOOLS, uploadDir: null });
    expect(
      instance.check(`${P}browser_file_upload`, { paths: [path.join(assets, 'cv.pdf')] }).allow,
    ).toBe(false);
  });
});
