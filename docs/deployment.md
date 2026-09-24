# Production deployment

Run the Node process behind an HTTPS reverse proxy. WebSocket upgrades must be forwarded to `/api/v1/sessions/`.

```nginx
location / {
  proxy_pass http://127.0.0.1:8787;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
location /api/v1/sessions/ {
  proxy_pass http://127.0.0.1:8787;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_read_timeout 1h;
}
```

Use a process manager (systemd, Docker, or PM2) and set `PUBLIC_BASE_URL` to the public HTTPS origin. Keep `ADMIN_TOKEN` and any future signing keys outside Git.

The application already applies a per-IP HTTP rate limit, caps WebSocket messages at 256 KiB, authenticates every room with an unguessable bearer token, refuses viewer writes, and expires idle rooms after six hours. At the edge, add TLS, a WAF/rate limit for `POST /api/v1/sessions`, connection limits for WebSockets, and a global CDN/DDoS provider policy. Persistent rooms and abuse reporting should be introduced only when the product needs accounts; the current in-memory room store intentionally keeps the first deployment simple.
