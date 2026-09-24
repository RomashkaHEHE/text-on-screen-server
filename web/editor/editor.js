import * as Y from "https://esm.sh/yjs@13.6.27?bundle";
const params = new URLSearchParams(location.search);
const session = params.get("session");
const token = params.get("token");
const status = document.querySelector("#status");
const room = document.querySelector("#room");
const textarea = document.querySelector("#text");
if (!session || !token) {
  status.textContent = "В ссылке нет комнаты";
  throw new Error("Missing session or token");
}
room.textContent = `Комната ${session}`;
const doc = new Y.Doc();
const text = doc.getText("text");
const wsProtocol = location.protocol === "https:" ? "wss:" : "ws:";
const socket = new WebSocket(`${wsProtocol}//${location.host}/api/v1/sessions/${encodeURIComponent(session)}?token=${encodeURIComponent(token)}`);
let connected = false;
function render() { if (textarea.value !== text.toString()) textarea.value = text.toString(); }
text.observe(render);
doc.on("update", (update, origin) => {
  if (origin === "remote" || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type: "sync", update: btoa(String.fromCharCode(...update)) }));
});
textarea.addEventListener("input", () => {
  doc.transact(() => { text.delete(0, text.length); text.insert(0, textarea.value); }, "local");
});
socket.addEventListener("open", () => { connected = true; status.textContent = "Подключено"; status.classList.add("ok"); });
socket.addEventListener("close", () => { connected = false; status.textContent = "Соединение закрыто"; status.classList.remove("ok"); });
socket.addEventListener("message", event => {
  const message = JSON.parse(event.data);
  if (message.type === "sync") {
    const binary = Uint8Array.from(atob(message.update), char => char.charCodeAt(0));
    Y.applyUpdate(doc, binary, "remote");
    render();
  }
  if (message.type === "error") status.textContent = `Ошибка: ${message.code}`;
});
