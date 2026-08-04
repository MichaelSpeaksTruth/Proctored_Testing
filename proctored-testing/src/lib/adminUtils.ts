export function isAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  return (
    email === process.env.NEXT_PUBLIC_ADMIN_1 ||
    email === process.env.NEXT_PUBLIC_ADMIN_2
  );
}
