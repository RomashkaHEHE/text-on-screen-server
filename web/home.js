const create = document.querySelector("#create");
const result = document.querySelector("#result");
create.addEventListener("click", async () => {
  create.disabled = true;
  result.hidden = false;
  result.textContent = "Создаём комнату…";
  try {
    const response = await fetch("/api/v1/sessions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
    if (!response.ok) throw new Error("Не удалось создать комнату");
    const data = await response.json();
    result.innerHTML = `Ссылка редактора: <a href="${data.editorUrl}">${data.editorUrl}</a><br><small>Код комнаты: ${data.sessionId}</small>`;
  } catch (error) {
    result.textContent = error instanceof Error ? error.message : "Ошибка";
    create.disabled = false;
  }
});
