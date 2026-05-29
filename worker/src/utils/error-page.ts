// Error status page showing the connection chain:
// Internet → prod.bd Worker → prod.bd Agent → Your Service
//
// failedAt: index of the arrow that broke (0-2)
//   0 = couldn't reach worker (shouldn't happen, worker serves this)
//   1 = worker can't reach agent (CLI not connected / tunnel down)
//   2 = agent can't reach service (local server down / upstream error)

export function errorPage(
    status: number,
    failedAt: number,
    detail: string,
    subdomain: string,
    baseDomain: string,
): Response {
    const tunnelHost = subdomain + baseDomain;
    const nodes = ["Internet", `tunnel${baseDomain} Worker`, `tunnel${baseDomain} Agent`, "Your Service"];

    const stepsHtml = nodes.map((label, i) => {
        const ok = i <= failedAt;
        const node = `<span class="node ${ok ? "ok" : "fail"}">${label}</span>`;
        if (i === nodes.length - 1) return node;
        const arrowOk = i < failedAt;
        return node + `<span class="arrow ${arrowOk ? "ok" : (i === failedAt ? "fail" : "dim")}">→</span>`;
    }).join("");

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${status} - ${tunnelHost}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:-apple-system,system-ui,sans-serif;background:#0a0a0a;color:#e5e5e5}
.card{max-width:600px;width:90%;text-align:center;padding:3rem 2rem;border:1px solid #222;border-radius:16px;background:#111}
.status{font-size:4rem;font-weight:800;letter-spacing:-.04em;background:linear-gradient(135deg,#ff4444,#ff6b6b);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.chain{display:flex;align-items:center;justify-content:center;gap:.5rem;margin:2rem 0;flex-wrap:wrap}
.node{padding:.4rem .8rem;border-radius:8px;font-size:.8rem;font-weight:600;white-space:nowrap}
.node.ok{background:#0a2a0a;color:#4ade80;border:1px solid #166534}
.node.fail{background:#2a0a0a;color:#f87171;border:1px solid #991b1b}
.arrow{font-size:1.2rem;font-weight:700}
.arrow.ok{color:#4ade80}
.arrow.fail{color:#f87171}
.arrow.dim{color:#faa}
.detail{color:#eee;font-size:.85rem;margin-top:1rem;font-family:ui-monospace,monospace;background:#0a0a0a;padding:.75rem 1rem;border-radius:8px;border:1px solid #1a1a1a;word-break:break-all}
.sub{color:#aaa;font-size:.75rem;margin-top:1.5rem}
.sub a{color:#aaa;text-decoration:none}
</style>
</head>
<body>
<div class="card">
  <div class="status">${status}</div>
  <div class="chain">${stepsHtml}</div>
  <div class="detail">${esc(detail)}</div>
  <div class="sub">${tunnelHost} &middot; <a target="_blank" href="https://prod.bd">powered by prod.bd</a></div>
</div>
</body>
</html>`;

    return new Response(html, {
        status,
        headers: { "Content-Type": "text/html; charset=utf-8" },
    });
}

function esc(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
