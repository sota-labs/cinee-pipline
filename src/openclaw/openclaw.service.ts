import { Injectable, Logger } from '@nestjs/common';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

@Injectable()
export class OpenClawService {
  private readonly logger = new Logger(OpenClawService.name);
  private readonly agent = process.env.OPENCLAW_AGENT ?? 'main';

  async executeAgent(prompt: string): Promise<string> {
    const escaped = prompt.replace(/'/g, "'\\''");
    const cmd = `openclaw agent --agent ${this.agent} --message '${escaped}'`;
    return this.runCli(cmd);
  }

  async registerCron(name: string, schedule: string, message: string, description = ''): Promise<string> {
    const escaped = message.replace(/'/g, "'\\''");
    const cmd = [
      `openclaw cron add`,
      `--name "${name}"`,
      `--cron "${schedule}"`,
      `--tz "Asia/Ho_Chi_Minh"`,
      `--session isolated`,
      `--message '${escaped}'`,
      `--no-deliver`,
      description ? `--description "${description}"` : '',
    ].filter(Boolean).join(' ');
    return this.runCli(cmd);
  }

  async removeCron(name: string): Promise<string> {
    return this.runCli(`openclaw cron remove --name "${name}"`);
  }

  async triggerCron(name: string): Promise<string> {
    return this.runCli(`openclaw cron trigger --name "${name}"`);
  }

  private async runCli(cmd: string): Promise<string> {
    this.logger.debug(`Running: ${cmd.slice(0, 120)}...`);
    const { stdout, stderr } = await execAsync(cmd, { timeout: 120_000 });
    if (stderr) this.logger.warn(`[openclaw stderr] ${stderr.slice(0, 200)}`);
    return stdout;
  }
}
