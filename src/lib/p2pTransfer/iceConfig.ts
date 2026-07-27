/**
 * ICE config: STUN for direct / LAN, public TURN relays as fallback.
 * WebRTC DTLS encrypts data-channel bytes on both direct and relayed paths.
 * TURN only forwards opaque packets — no cloud file storage.
 *
 * We list several anonymous public TURN servers so that at least one relay is
 * reachable across networks / NATs. Direct P2P is always preferred; the relay
 * is only used when ICE cannot punch a direct path.
 */

export const P2P_ICE_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    // Open Relay Project — public relay when direct ICE fails.
    { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
    { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
    { urls: "turn:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" },
  ],
  iceCandidatePoolSize: 4,
};

/** Classify selected candidate pair as direct vs relay. */
export async function detectConnectionMode(
  pc: RTCPeerConnection
): Promise<"direct" | "relay" | "unknown"> {
  try {
    const stats = await pc.getStats();
    let localId: string | undefined;
    let remoteId: string | undefined;
    stats.forEach((report) => {
      if (report.type !== "candidate-pair") return;
      const pair = report as RTCStats & {
        state?: string;
        nominated?: boolean;
        selected?: boolean;
        localCandidateId?: string;
        remoteCandidateId?: string;
      };
      if (pair.selected || pair.nominated || pair.state === "succeeded") {
        localId = pair.localCandidateId;
        remoteId = pair.remoteCandidateId;
      }
    });
    if (!localId && !remoteId) return "unknown";
    const types: string[] = [];
    stats.forEach((report) => {
      if (report.id === localId || report.id === remoteId) {
        const cand = report as RTCStats & { candidateType?: string };
        if (cand.candidateType) types.push(cand.candidateType);
      }
    });
    if (types.includes("relay")) return "relay";
    if (types.some((t) => t === "srflx" || t === "prflx" || t === "host")) return "direct";
    return "unknown";
  } catch {
    return "unknown";
  }
}
