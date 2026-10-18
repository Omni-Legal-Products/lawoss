export function retryStopReason(status: { type: string; attempt?: number; message?: string }) {
  if (status.type !== "retry") return null;
  const message = status.message ?? "Provider unavailable";
  const terminal = /(?:invalid.?api.?key|authentication failed|unauthorized|insufficient.quota|budget.{0,30}(?:exceeded|exhausted)|usage pricing.{0,40}unavailable)/i.test(message);
  if (!terminal && (status.attempt ?? 0) < 3) return null;
  return `Automatic retries stopped. ${message.slice(0, 1000)}\n\nCheck the provider connection or choose another model, then send the request again.`;
}
