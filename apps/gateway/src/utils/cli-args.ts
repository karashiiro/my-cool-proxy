export interface CLIArgs {
  showConfigPath: boolean;
  help: boolean;
}

/**
 * Parse command line arguments.
 *
 * @param argv - Process arguments (typically process.argv.slice(2))
 * @returns Parsed CLI arguments
 */
export function parseArgs(argv: string[]): CLIArgs {
  return {
    showConfigPath: argv.includes("--config-path") || argv.includes("-c"),
    help: argv.includes("--help") || argv.includes("-h"),
  };
}
