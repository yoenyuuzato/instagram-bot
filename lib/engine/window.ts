export const DM_WINDOW_MS = 24 * 60 * 60 * 1000;
export const PRIVATE_REPLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Standardní DM lze poslat jen do 24 h od poslední zprávy uživatele. */
export function isWithinDmWindow(lastInteractionAt: Date | null | undefined, now = new Date()) {
  return !!lastInteractionAt && now.getTime() - lastInteractionAt.getTime() < DM_WINDOW_MS;
}

/** Private reply na komentář lze poslat do 7 dní od vytvoření komentáře. */
export function isWithinPrivateReplyWindow(commentCreatedAt: Date, now = new Date()) {
  return now.getTime() - commentCreatedAt.getTime() < PRIVATE_REPLY_WINDOW_MS;
}
