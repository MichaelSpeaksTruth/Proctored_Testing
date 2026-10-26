export type PersonnelRole = 'Question Setter' | "Spectator's View" | 'Admin L1';

export const encodeEmail = (e: string): string => e.trim().toLowerCase().replace(/\./g, ',');
export const decodeEmail = (k: string): string => k.replace(/,/g, '.');

export function isAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  const cleanEmail = email.trim().toLowerCase();
  const admin1 = process.env.NEXT_PUBLIC_ADMIN_1?.trim().toLowerCase();
  const admin2 = process.env.NEXT_PUBLIC_ADMIN_2?.trim().toLowerCase();
  return cleanEmail === admin1 || cleanEmail === admin2;
}

export function isSupremeAdmin(email: string | null | undefined): boolean {
  return isAdmin(email);
}

export function isQuestionSetter(role: string | null | undefined): boolean {
  return role === 'Question Setter';
}

export function isSpectator(role: string | null | undefined): boolean {
  return role === "Spectator's View";
}

export function isAdminL1(role: string | null | undefined): boolean {
  return role === 'Admin L1';
}

export function isDisputeAuthority(email: string | null | undefined, role: string | null | undefined): boolean {
  return isAdmin(email) || role === 'Admin L1';
}

export function generateQuestionTag(): string {
  const digits = Math.floor(100 + Math.random() * 900).toString(); // 3 digits
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let randLetters = '';
  for (let i = 0; i < 3; i++) randLetters += letters.charAt(Math.floor(Math.random() * letters.length));
  
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let randChars = '';
  for (let i = 0; i < 3; i++) randChars += chars.charAt(Math.floor(Math.random() * chars.length));
  
  return `${digits}${randLetters}${randChars}`;
}
