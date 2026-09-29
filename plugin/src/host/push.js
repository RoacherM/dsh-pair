/**
 * Web Push to paired phones (the PWA's service worker). Payloads are encrypted to the phone's
 * subscription keys (RFC 8291), so Apple/Google only relay ciphertext. We still send summaries only.
 */
import webpush from 'web-push';

export function createPush({ state, log = () => {}, isOnline = () => false }) {
  const vapid = state.vapid;
  const details = { subject: 'mailto:dsh-pair@localhost.invalid', publicKey: vapid.publicKey, privateKey: vapid.privateKey };

  async function sendTo(device, payload) {
    if (!device.push?.endpoint) return { sent: false, reason: 'no-subscription' };
    try {
      await webpush.sendNotification(device.push, JSON.stringify(payload), {
        vapidDetails: details, TTL: 6 * 3600, urgency: payload.urgent ? 'high' : 'normal', topic: payload.topic,
      });
      return { sent: true };
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) {
        await state.updateDevice(device.id, { push: null });
        return { sent: false, reason: 'expired' };
      }
      log(`dsh-pair: 推送到「${device.name}」失败：${error.statusCode ?? ''} ${error.body ?? error.message}`);
      return { sent: false, reason: String(error.statusCode ?? error.message) };
    }
  }

  return {
    publicKey: vapid.publicKey,
    sendTo,
    /** Notify every paired device that is not connected right now (an open app sees the event live). */
    async notify(payload, { includeOnline = false } = {}) {
      const targets = state.devices().filter((device) => device.push && (includeOnline || !isOnline(device.id)));
      await Promise.all(targets.map((device) => sendTo(device, payload)));
    },
  };
}
