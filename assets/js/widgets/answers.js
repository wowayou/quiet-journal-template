// These are original prompts, not advice or a remote/AI service. No input or storage.
export function nextIndex(current, length, random = Math.random) {
  if (length < 2) return 0;
  return (current + 1 + Math.floor(random() * (length - 1))) % length;
}

if (typeof document !== "undefined") {
  document.querySelectorAll('[data-widget="answers"]').forEach((root) => {
    const phrases = [...root.querySelectorAll("[data-answer-list] li")].map((item) => item.textContent);
    const output = root.querySelector("[data-answer]");
    const button = root.querySelector("[data-answer-button]");
    let current = 0;
    button.hidden = false;
    button.addEventListener("click", () => {
      current = nextIndex(current, phrases.length);
      output.textContent = phrases[current];
    });
  });
}
