import http from "node:http";
import worker from "../worker/index.js";

const port = Number(process.env.PORT || 4173);
const server = http.createServer(async (req, res) => {
  const body = req.method === "GET" || req.method === "HEAD" ? undefined : req;
  const request = new Request(`http://127.0.0.1:${port}${req.url}`, {
    method: req.method,
    headers: req.headers,
    body,
    duplex: body ? "half" : undefined,
  });
  const response = await worker.fetch(request);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  if (response.body) {
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  }
  res.end();
});

server.listen(port, "127.0.0.1", () => console.log(`Local: http://127.0.0.1:${port}`));
