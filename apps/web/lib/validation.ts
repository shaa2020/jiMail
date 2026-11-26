export function passwordProblems(pw: string): string | null {
  if (pw.length < 10) return 'Use at least 10 characters';
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/\d/.test(pw)) return 'Mix upper and lower case letters and at least one digit';
  return null;
}
