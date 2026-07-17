// Modo privacidade: borra os @ de terceiros na UI (pra tirar print com segurança).
// Aplica a classe `pii-blur` no <body>; o CSS borra tudo que tiver a classe `pii`.
// Blur fica gravado no pixel do screenshot (irreversível na imagem); hover revela pra trabalhar.
const KEY = "codexig_privacy";

export function privacyOn(): boolean {
  return localStorage.getItem(KEY) === "1";
}

export function setPrivacy(v: boolean) {
  localStorage.setItem(KEY, v ? "1" : "0");
  document.body.classList.toggle("pii-blur", v);
}

export function initPrivacy() {
  if (privacyOn()) document.body.classList.add("pii-blur");
}
