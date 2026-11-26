import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { logger } from './log';

/**
 * Keeps the computer awake while runs are active (spec section 10), and lets
 * it sleep again when the worker is idle. No extra package: each system has a
 * small built-in way to hold a "do not sleep" request for as long as a helper
 * process lives, so killing the helper releases it.
 *
 *  - Windows: PowerShell calls SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)
 *  - Linux / ChromeOS container: systemd-inhibit, where available
 *  - macOS: caffeinate
 *
 * The README also tells John to set sleep to "Never" while plugged in.
 */

const WINDOWS_SCRIPT = [
  '$signature = \'[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);\'',
  '$api = Add-Type -MemberDefinition $signature -Name Power -Namespace FgvKeepAwake -PassThru',
  // ES_CONTINUOUS (0x80000000) | ES_SYSTEM_REQUIRED (0x00000001)
  '[void]$api::SetThreadExecutionState([uint32]2147483649)',
  'while ($true) { Start-Sleep -Seconds 30 }',
].join('; ');

function helperCommand(): { command: string; args: string[] } | null {
  if (process.platform === 'win32') {
    return {
      command: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', WINDOWS_SCRIPT],
    };
  }
  if (process.platform === 'darwin') return { command: 'caffeinate', args: ['-i'] };
  if (process.platform === 'linux') {
    const found = spawnSync('systemd-inhibit', ['--version'], { stdio: 'ignore' });
    if (found.status !== 0) return null;
    return {
      command: 'systemd-inhibit',
      args: [
        '--what=idle:sleep',
        '--who=fgv-worker',
        '--why=Bots are running',
        'sleep',
        'infinity',
      ],
    };
  }
  return null;
}

export class KeepAwake {
  private child: ChildProcess | null = null;
  private warned = false;

  /** Call with true while runs are active and false when the worker is idle. */
  set(active: boolean): void {
    if (active) this.acquire();
    else this.release();
  }

  private acquire(): void {
    if (this.child) return;
    const helper = helperCommand();
    if (!helper) {
      if (!this.warned) {
        this.warned = true;
        logger.warn(
          'Cannot keep this computer awake automatically. Set sleep to Never while plugged in.',
        );
      }
      return;
    }
    try {
      const child = spawn(helper.command, helper.args, { stdio: 'ignore', windowsHide: true });
      child.on('error', () => {
        this.child = null;
      });
      child.on('exit', () => {
        if (this.child === child) this.child = null;
      });
      this.child = child;
    } catch {
      this.child = null;
    }
  }

  release(): void {
    if (!this.child) return;
    this.child.kill();
    this.child = null;
  }
}
