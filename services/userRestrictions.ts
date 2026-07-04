import { User } from './types';

// ayman.mansour@smartforce-eg.com — hidden from: payroll & KPI tabs (HR dashboard),
// financial management section (sidebar). Matched by profile id with email/username fallback.
const RESTRICTED_IDS = ['8772b4ea-72fc-45ed-aba9-367c3fb15aa5'];
const RESTRICTED_EMAILS = ['ayman.mansour@smartforce-eg.com'];

export const isRestrictedHrUser = (user: User): boolean =>
    RESTRICTED_IDS.includes(user.id) ||
    RESTRICTED_EMAILS.includes((user.email || user.username || '').toLowerCase());
