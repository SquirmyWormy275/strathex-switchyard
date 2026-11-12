/** Entered only by the Linux guardian through setpriv; exec keeps the kernel parent-death signal. */
const [guardian, executable, argumentsJson] = process.argv.slice(2);
if (process.platform !== "linux" || !/^[1-9][0-9]*$/.test(guardian ?? "") || process.ppid !== Number(guardian) || typeof process.execve !== "function") process.exit(2);
const args = JSON.parse(argumentsJson);
if (!Array.isArray(args) || args.some((value) => typeof value !== "string")) process.exit(2);
// setpriv has already installed PR_SET_PDEATHSIG. Checking ppid afterwards
// closes the parent-exited-before-prctl race; execve preserves that signal.
process.execve(executable, [executable, ...args], process.env);
