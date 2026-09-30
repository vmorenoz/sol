/** Root-relative Flutter tool outputs, never arbitrary directories named ephemeral. */
const flutterOutputs = [
  'ios/Flutter/ephemeral', 'macos/Flutter/ephemeral',
  'windows/flutter/ephemeral', 'linux/flutter/ephemeral',
  'ios/.symlinks', 'macos/.symlinks',
];

/** Protect both inputs and their ancestors against replacement by ignored links. */
export function disposableFlutterPath(file: string, protectedPaths: ReadonlySet<string>): boolean {
  const normalized = file.split('\\').join('/');
  if (!flutterOutputs.some(root => normalized === root || normalized.startsWith(root + '/'))) return false;
  for (const input of protectedPaths) {
    if (input === normalized || input.startsWith(normalized + '/')) return false;
  }
  return true;
}
