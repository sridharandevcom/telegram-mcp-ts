/**
 * Tiny interactive prompt helpers for the auth CLI, built on node's readline so
 * we pull in zero extra dependencies.
 *
 * Prompts and all human-facing text go to stderr; the final session string is
 * the only thing written to stdout, so `telegram-mcp-ts-auth login > session.txt`
 * captures exactly the secret and nothing else.
 */

import * as readline from "node:readline";

/** Ask a question and return the trimmed answer. */
export function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  return new Promise<string>((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Ask for a secret without echoing keystrokes (used for the 2FA password).
 * Falls back to a visible prompt if stdin is not a TTY.
 */
export function askHidden(question: string): Promise<string> {
  const input = process.stdin;
  const output = process.stderr;

  if (!input.isTTY) {
    return ask(question);
  }

  return new Promise<string>((resolve) => {
    const rl = readline.createInterface({ input, output, terminal: true });

    // Mute echo: intercept the output writes that readline performs.
    const mutableOut = output as NodeJS.WriteStream & { _origWrite?: typeof output.write };
    let muted = false;
    const realWrite = output.write.bind(output);
    mutableOut._origWrite = realWrite as typeof output.write;
    (output as unknown as { write: typeof output.write }).write = ((chunk: unknown, ...rest: unknown[]) => {
      if (muted) {
        // Allow the prompt itself through once, then swallow the echoed chars.
        return true;
      }
      return (realWrite as (...a: unknown[]) => boolean)(chunk, ...rest);
    }) as typeof output.write;

    output.write(question);
    muted = true;

    rl.question("", (answer) => {
      muted = false;
      (output as unknown as { write: typeof output.write }).write = realWrite as typeof output.write;
      output.write("\n");
      rl.close();
      resolve(answer.trim());
    });
  });
}

/** Ask a yes/no question; returns true for y/yes (case-insensitive). */
export async function confirm(question: string): Promise<boolean> {
  const answer = (await ask(`${question} [y/N] `)).toLowerCase();
  return answer === "y" || answer === "yes";
}
