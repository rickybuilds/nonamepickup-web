const rows = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", { label: "⌫", key: "Backspace", code: "Backspace", width: 1.6 }],
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  [{ label: "⇥", key: "Tab", code: "Tab", width: 1.4 }, "a", "s", "d", "f", "g", "h", "j", "k", "l", { label: "⏎", key: "Enter", code: "Enter", width: 1.9, accent: true }],
  [{ label: "⇧", shift: true, width: 1.6 }, "z", "x", "c", "v", "b", "n", "m", ",", "."],
  [{ label: "ESC", key: "Escape", code: "Escape", width: 1.7, small: true }, "-", "'", { label: "␠", char: " ", width: 5 }, { label: "×", hide: true, width: 1.7, small: true }]
];

const shifted = { "1": "!", "2": "@", "3": "#", "4": "$", "5": "%", "6": "^", "7": "&", "8": "*", "9": "(", "0": ")", "-": "_", "'": '"', ",": "<", ".": ">" };

function dispatchKey(key, code, shift = false, text = "") {
  const event = details => {
    const dispatched = new KeyboardEvent(details.type, { bubbles: true, cancelable: true, composed: true, ...details });
    for (const property of ["keyCode", "charCode", "which"]) {
      if (details[property] !== undefined && dispatched[property] !== details[property]) {
        try { Object.defineProperty(dispatched, property, { get: () => details[property] }); } catch {}
      }
    }
    document.body.dispatchEvent(dispatched);
  };
  const keyCode = key.length === 1 ? key.toUpperCase().charCodeAt(0) : ({ Backspace: 8, Tab: 9, Enter: 13, Escape: 27 }[key] || 0);
  dispatched({ type: "keydown", key, code, keyCode, which: keyCode, charCode: 0, shiftKey: shift });
  if (text) dispatched({ type: "keypress", key: text, code, keyCode: text.charCodeAt(0), which: text.charCodeAt(0), charCode: text.charCodeAt(0), shiftKey: shift });
  dispatched({ type: "keyup", key, code, keyCode, which: keyCode, charCode: 0, shiftKey: shift });
}

export function installTouchKeyboard(client) {
  const touch = new URLSearchParams(location.search).get("touch");
  const enabled = touch === "1" || (touch !== "0" && navigator.maxTouchPoints > 0 && matchMedia("(hover: none)").matches);
  if (!enabled) return;

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "touch-keyboard-toggle";
  toggle.textContent = "⌨";
  toggle.setAttribute("aria-label", "Toggle keyboard");
  const keyboard = document.createElement("div");
  keyboard.className = "touch-keyboard";
  const preview = document.createElement("div");
  preview.className = "touch-keyboard-preview";
  preview.textContent = "type here…";
  keyboard.append(preview);
  let open = false;
  let shift = false;
  let typed = "";

  const render = () => {
    preview.textContent = typed || "type here…";
    preview.classList.toggle("empty", !typed);
  };
  const close = () => {
    open = false;
    keyboard.classList.remove("open");
    toggle.classList.remove("active");
    shift = false;
    typed = "";
    render();
    client.command("touch_enable 1");
  };
  const press = (item, element) => {
    element.classList.add("down");
    if (item.shift) { shift = !shift; element.classList.toggle("held", shift); return; }
    if (item.hide) return close();
    const raw = typeof item === "string" ? item : (item.char ?? item.key ?? "");
    const value = shift && shifted[raw] ? shifted[raw] : shift ? raw.toUpperCase() : raw;
    if (item.key === "Backspace") typed = typed.slice(0, -1);
    else if (item.key !== "Tab" && item.key !== "Enter" && item.key !== "Escape") typed += value;
    dispatchKey(typeof item === "string" || item.char ? value : item.key, typeof item === "string" ? `Key${raw.toUpperCase()}` : item.code, shift, value);
    if (shift) { shift = false; keyboard.querySelector("[data-shift]")?.classList.remove("held"); }
    render();
  };
  for (const row of rows) {
    const rowElement = document.createElement("div");
    rowElement.className = "touch-keyboard-row";
    for (const item of row) {
      const key = document.createElement("button");
      key.type = "button";
      key.className = `touch-keyboard-key${item && item.small ? " small" : ""}${item && item.accent ? " accent" : ""}`;
      key.textContent = typeof item === "string" ? item : item.label;
      if (item?.width) key.style.flexGrow = String(item.width);
      if (item?.shift) key.dataset.shift = "1";
      key.addEventListener("pointerdown", event => { event.preventDefault(); event.stopPropagation(); press(item, key); });
      key.addEventListener("pointerup", () => key.classList.remove("down"));
      rowElement.append(key);
    }
    keyboard.append(rowElement);
  }
  keyboard.addEventListener("touchstart", event => event.preventDefault(), { passive: false });
  toggle.addEventListener("pointerdown", event => {
    event.preventDefault();
    open = !open;
    if (open) {
      keyboard.classList.add("open");
      toggle.classList.add("active");
      client.command("touch_enable 0");
    } else close();
  });
  document.body.append(toggle, keyboard);
}
