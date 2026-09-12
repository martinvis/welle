// RTC for the 3D world -- two layers, mirroring the 2D project (src/rtc.js):
//
//   Rtc      transport only. Invite/answer codes in, data channels out.
//            Serverless WebRTC: the host creates an offer code, the guest
//            pastes it and returns an answer code, the host accepts it.
//            STUN only, no TURN -- same trust model and limitations as 2D.
//
//   Session  presence for a walkable world. Unlike the 2D table there is no
//            authoritative rules engine here: peers exchange small ops and
//            each client applies them to its own deterministic world.
//              pose  { k, id, x, y, z, w, m }   a peer's feet + heading
//              door  { k, i, open }             a door toggled
//              env   { k, weather, int, night, autumn }  world switches
//            The HOST relays guest ops to every other guest, so the host tab
//            must stay open (exactly like the 2D DM). Ambient life (herds,
//            riders, butterflies) is driven by each client's own clock and
//            is NOT synchronized -- see docs/networking.md.

const bus = () => {
  const fns = {};
  return {
    on(k, f) { (fns[k] ??= []).push(f); },
    emit(k, ...a) { for (const f of fns[k] ?? []) f(...a); },
  };
};

export const Rtc = (() => {
  const CFG = { iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }] };
  const iceComplete = (pc) => pc.iceGatheringState === "complete"
    ? Promise.resolve()
    : new Promise((res) => {
        const check = () => {
          if (pc.iceGatheringState === "complete") { pc.removeEventListener("icegatheringstatechange", check); res(); }
        };
        pc.addEventListener("icegatheringstatechange", check);
        setTimeout(res, 4000);
      });
  const encode = (d) => btoa(JSON.stringify(d));
  // codes get wrapped/padded by messengers -- strip ALL whitespace, not
  // just the edges, or atob chokes on a line break mid-code
  const decode = (s) => JSON.parse(atob(s.replace(/\s+/g, "")));

  const wrap = (dc) => {
    const ch = {
      open: false,
      send(o) { try { dc.send(JSON.stringify(o)); } catch (e) {} },
      onMessage(fn) { dc.onmessage = (e) => fn(JSON.parse(e.data)); },
      onOpen(fn) { dc.onopen = () => { ch.open = true; fn(); }; },
      onClose(fn) { dc.onclose = () => { ch.open = false; fn(); }; },
    };
    return ch;
  };

  async function invite() {
    const pc = new RTCPeerConnection(CFG);
    const ch = wrap(pc.createDataChannel("world"));
    await pc.setLocalDescription(await pc.createOffer());
    await iceComplete(pc);
    return { code: encode(pc.localDescription), channel: ch,
             accept: async (replyCode) => pc.setRemoteDescription(decode(replyCode)) };
  }

  function join(offerCode) {
    const pc = new RTCPeerConnection(CFG);
    let resolveCh;
    const channel = new Promise((r) => { resolveCh = r; });
    pc.ondatachannel = (ev) => resolveCh(wrap(ev.channel));
    const code = (async () => {
      await pc.setRemoteDescription(decode(offerCode));
      await pc.setLocalDescription(await pc.createAnswer());
      await iceComplete(pc);
      return encode(pc.localDescription);
    })();
    return { code, channel };
  }

  return { invite, join };
})();

// Both sessions expose: { isHost, myId, events, send(op), online(), peers() }
// Events: op(op, from) | peers | ready(welcome) | gone(peerId) | lost

export function HostSession(opts = {}) {
  const events = bus();
  const conns = new Map();   // peerId -> { channel, name }
  const broadcast = (msg, except = null) => {
    for (const [id, c] of conns) if (c.channel.open && id !== except) c.channel.send(msg);
  };

  async function invite() {
    const peerId = "p" + Math.random().toString(36).slice(2, 8);
    const inv = await Rtc.invite();
    inv.channel.onOpen(() => { conns.set(peerId, { channel: inv.channel, name: "guest" }); events.emit("peers"); });
    inv.channel.onMessage((msg) => {
      if (msg.t === "hello") {
        conns.get(peerId).name = String(msg.name || "guest").slice(0, 20);
        // `time` carries the host's world clock: ambient life is a pure
        // function of that clock, so a guest fast-forwards its own
        // simulation to the same instant and stays in lockstep forever
        inv.channel.send({ t: "welcome", id: peerId, params: location.search,
                           time: opts.time ? opts.time() : 0 });
        events.emit("peers");
      } else if (msg.t === "op") {
        const op = { ...msg.op, id: peerId };     // ops are stamped with their true sender
        events.emit("op", op, peerId);
        broadcast({ t: "op", op }, peerId);       // relay to every other guest
      }
    });
    inv.channel.onClose(() => { conns.delete(peerId); events.emit("gone", peerId); events.emit("peers"); });
    return inv;   // { code, accept, channel }
  }

  return {
    isHost: true, myId: "host", events, invite,
    send: (op) => broadcast({ t: "op", op: { ...op, id: "host" } }),
    online: () => [...conns.values()].filter((c) => c.channel.open).length,
    peers: () => [...conns.values()].map((c) => c.name),
  };
}

export function GuestSession(name = "guest") {
  const events = bus();
  let link = null, myId = null;

  async function answer(offerCode) {
    const j = Rtc.join(offerCode);
    j.channel.then((ch) => {
      link = ch;
      ch.onOpen(() => ch.send({ t: "hello", name }));
      ch.onMessage((msg) => {
        if (msg.t === "welcome") { myId = msg.id; events.emit("ready", msg); }
        else if (msg.t === "op") events.emit("op", msg.op, "host");
      });
      ch.onClose(() => events.emit("lost"));
    });
    return j.code;
  }

  return {
    isHost: false, get myId() { return myId; }, events, answer,
    send: (op) => { if (link?.open) link.send({ t: "op", op }); },
    online: () => (link?.open ? 1 : 0),
    peers: () => [],
  };
}
