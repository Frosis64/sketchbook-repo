// Простая форма входа. При успехе — редирект на страницу, с которой
// пришли (?next=...), иначе на корень приложения.
const form = document.getElementById("login-form");
const errorEl = document.getElementById("error");
const submitBtn = document.getElementById("submit-btn");

function nextUrl() {
  const params = new URLSearchParams(location.search);
  const next = params.get("next");
  return next && next.startsWith("/") ? next : "/";
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorEl.hidden = true;
  submitBtn.disabled = true;
  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;
  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      errorEl.textContent = data.error || "Не удалось войти";
      errorEl.hidden = false;
      submitBtn.disabled = false;
      return;
    }
    location.href = nextUrl();
  } catch (err) {
    errorEl.textContent = "Сервер недоступен, попробуйте ещё раз";
    errorEl.hidden = false;
    submitBtn.disabled = false;
  }
});
