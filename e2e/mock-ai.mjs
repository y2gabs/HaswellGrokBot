// Scripted stand-in for DeepSeek (chat/completions) and OpenAI (images).
import http from "node:http";
import zlib from "node:zlib";

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function png(r, g, b) {
  const w = 60, h = 40;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set([r, g, b], y * (w * 3 + 1) + 1 + x * 3);
  const chunk = (t, d) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(d.length);
    const td = Buffer.concat([Buffer.from(t), d]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]).toString("base64");
}

let n = 0;
const call = (name, args) => ({ id: `call_${++n}`, type: "function", function: { name, arguments: JSON.stringify(args) } });
const reply = (content, tool_calls) => ({
  choices: [{ finish_reason: tool_calls ? "tool_calls" : "stop", message: { role: "assistant", content, ...(tool_calls ? { tool_calls } : {}) } }],
});

function decide(body) {
  const msgs = body.messages;
  const system = msgs[0].content;
  const last = msgs[msgs.length - 1];
  if (!body.tools) {
    // Writer call.
    return reply("<p>Winter is hard on pipes.</p><h2>Simple steps</h2><ul><li>Insulate exposed pipes</li><li>Keep a tap dripping</li></ul><p>Call us if anything freezes.</p>");
  }
  const marketing = system.includes("Marketing bot");
  if (marketing) {
    if (last.role === "user" && last.content.includes("opened a new conversation")) return reply("", [call("get_site_context", {})]);
    if (last.role === "tool" && msgs.at(-2).tool_calls?.[0].function.name === "get_site_context") {
      return reply("Here are three ideas for your next announcement:", [
        call("offer_choices", {
          options: [
            { title: "Protect your pipes this winter", description: "Seasonal tips to avoid frozen pipes." },
            { title: "Meet our emergency repair team", description: "A spotlight on fast call-outs." },
            { title: "Why annual boiler checks matter", description: "A service spotlight." },
          ],
        }),
      ]);
    }
    if (last.role === "user" && last.content.startsWith("Protect your pipes")) {
      return reply("", [call("write_article", { subject: "Protect your pipes this winter", brief: "Tips to prevent frozen pipes." })]);
    }
    if (last.role === "tool" && msgs.at(-2).tool_calls?.[0].function.name === "write_article") {
      return reply("Here's the draft. Now pick a featured image:", [call("generate_featured_image", { description: "Frosty copper pipes in a warm basement" })]);
    }
    if (last.role === "user" && last.content.includes("picked image")) {
      return reply("Ready to post — approve below.", [call("publish_announcement", {})]);
    }
    if (last.role === "user" && last.content.includes("approved")) {
      const link = /link (\S+?)[,)]/.exec(last.content)?.[1] ?? "";
      return reply(`Published! ${link}`);
    }
    return reply("Okay.");
  }
  // Website manager.
  if (last.role === "user" && /tagline to (.+)$/i.test(last.content)) return reply("", [call("get_website_settings", {})]);
  if (last.role === "tool" && msgs.at(-2).tool_calls?.[0].function.name === "get_website_settings") {
    const userMsg = [...msgs].reverse().find((m) => m.role === "user" && /tagline to/i.test(m.content));
    const value = /tagline to (.+)$/i.exec(userMsg.content)[1].replace(/^['"]|['"]$/g, "");
    return reply("Here's the change — tap Approve to apply it.", [
      call("update_website_settings", { section: "profile", fields: { long_tagline: value } }),
    ]);
  }
  if (last.role === "user" && last.content.includes("approved")) return reply("Done — your long tagline is updated.");
  if (last.role === "user" && last.content.includes("declined")) return reply("No problem, nothing was changed.");
  return reply("How can I help?");
}

http
  .createServer((req, res) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      const body = data ? JSON.parse(data) : {};
      let out;
      if (req.url.endsWith("/chat/completions")) out = decide(body);
      else if (req.url.endsWith("/images/generations")) {
        out = { output_format: "png", data: [png(200, 80, 60), png(60, 160, 90), png(60, 90, 200)].slice(0, body.n ?? 3).map((b64_json) => ({ b64_json })) };
      } else out = { error: { message: "unknown" } };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(out));
    });
  })
  .listen(4010, () => console.log("mock ai on 4010"));
