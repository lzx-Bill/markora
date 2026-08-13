const UI_LOCALE = "en-US";

export function formatDate(value: string | Date): string {
  return new Intl.DateTimeFormat(UI_LOCALE, { dateStyle: "medium" }).format(new Date(value));
}

export function formatDateTime(value: string | Date): string {
  return new Intl.DateTimeFormat(UI_LOCALE, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
