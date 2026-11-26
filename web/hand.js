// The stationary buttons are the hit targets. Only their illustrated faces rotate and lift.
const pageSize = 5;

export function mountHand(rail, cards, first, onPage) {
  if (!cards.length) {
    rail.textContent = "Your hand is empty.";
    return;
  }
  const start = Math.min(
    first,
    Math.floor((cards.length - 1) / pageSize) * pageSize,
  );
  const visible = cards.slice(start, start + pageSize);
  const fan = document.createElement("div");
  fan.className = "fan";
  fan.setAttribute("role", "group");
  fan.setAttribute("aria-label", "Cards in hand");
  fan.style.setProperty("--count", visible.length);
  const buttons = visible.map((card, i) => {
    const button = document.createElement("button");
    const position = i - (visible.length - 1) / 2;
    button.className = "fan-slot card";
    button.dataset.action = "card-" + (start + i);
    button.setAttribute(
      "aria-label",
      card.name +
        ", " +
        card.color +
        ", card " +
        (start + i + 1) +
        " of " +
        cards.length,
    );
    button.style.setProperty("--angle", position * 5 + "deg");
    button.style.setProperty("--drop", position * position * 1.4 + "px");
    const face = document.createElement("span");
    face.className = "fan-face deed " + card.color;
    const art = document.createElement("span");
    art.className = "fan-art";
    if (card.url) art.style.backgroundImage = 'url("' + card.url + '")';
    const title = document.createElement("strong");
    title.textContent = card.name;
    face.append(art, title);
    const hit = document.createElement("span");
    hit.className = "fan-hit";
    hit.setAttribute("aria-hidden", "true");
    button.append(face, hit);
    fan.append(button);
    return button;
  });
  function pageButton(label, offset, glyph) {
    const button = document.createElement("button");
    button.className = "fan-page";
    button.textContent = glyph;
    button.setAttribute("aria-label", label);
    button.disabled = offset < 0 || offset >= cards.length;
    button.onclick = () => onPage(offset);
    return button;
  }
  if (cards.length > pageSize) {
    rail.append(
      pageButton("Previous hand cards", start - pageSize, "‹"),
      fan,
      pageButton("Next hand cards", start + pageSize, "›"),
    );
  } else rail.append(fan);

  const preview = document.createElement("div");
  preview.className = "fan-preview";
  preview.hidden = true;
  preview.setAttribute("aria-hidden", "true");
  rail.append(preview);
  let active = -1;
  let pointer = null;
  function highlight(i) {
    if (active === i) return;
    if (active >= 0) buttons[active].classList.remove("lifted");
    active = i;
    preview.hidden = i < 0;
    if (i < 0) return;
    const card = visible[i];
    buttons[i].classList.add("lifted");
    const art = document.createElement("img");
    art.alt = "";
    const copy = document.createElement("div");
    const heading = document.createElement("strong");
    heading.textContent = card.name;
    const color = document.createElement("small");
    color.textContent = card.color;
    copy.append(color, heading);
    for (const [label, value] of [
      ["Basic", card.basic],
      ["Powered", card.powered],
    ]) {
      if (!value) continue;
      const line = document.createElement("p"),
        mode = document.createElement("b");
      mode.textContent = label + " · ";
      line.append(mode, value);
      copy.append(line);
    }
    preview.replaceChildren(copy);
    if (card.url) {
      art.src = card.url;
      preview.prepend(art);
    }
    const rect = fan.getBoundingClientRect();
    const above = rect.top - 8;
    const below = innerHeight - rect.bottom - 8;
    const placeAbove = above >= below;
    preview.style.maxHeight = Math.max(0, placeAbove ? above : below) + "px";
    preview.style.top =
      (placeAbove
        ? Math.max(4, above - preview.offsetHeight)
        : rect.bottom + 4) + "px";
  }
  function overCard(e) {
    // Hit-test the resting geometry even when pointer capture is active or a card lifts.
    const slot = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest(".fan-slot");
    return buttons.indexOf(slot);
  }
  // WebKit can dispatch a compatibility click at the newly opened sheet.
  // Consume the touch sequence before opening it so inspection can never play a card.
  let touchId = null;
  fan.addEventListener(
    "touchstart",
    (e) => {
      if (e.cancelable) e.preventDefault();
      if (e.touches.length !== 1) {
        touchId = null;
        highlight(-1);
        return;
      }
      const touch = e.changedTouches[0];
      touchId = touch.identifier;
      highlight(overCard(touch));
    },
    { passive: false },
  );
  fan.addEventListener(
    "touchmove",
    (e) => {
      if (e.cancelable) e.preventDefault();
      const touch = Array.from(e.changedTouches).find(
        (t) => t.identifier === touchId,
      );
      if (touch) highlight(overCard(touch));
    },
    { passive: false },
  );
  fan.addEventListener(
    "touchend",
    (e) => {
      if (e.cancelable) e.preventDefault();
      const touch = Array.from(e.changedTouches).find(
        (t) => t.identifier === touchId,
      );
      if (!touch) return;
      touchId = null;
      const index = overCard(touch);
      highlight(-1);
      if (index >= 0) buttons[index].click();
    },
    { passive: false },
  );
  fan.ontouchcancel = () => {
    touchId = null;
    highlight(-1);
  };
  fan.onpointerdown = (e) => {
    const slot = e.target.closest(".fan-slot");
    if (e.pointerType === "touch" || !slot || !e.isPrimary || e.button !== 0)
      return;
    pointer = e.pointerId;
    slot.setPointerCapture(pointer);
    highlight(buttons.indexOf(slot));
  };
  fan.onpointermove = (e) => {
    if (pointer === e.pointerId) highlight(overCard(e));
  };
  fan.onpointerup = (e) => {
    if (pointer !== e.pointerId) return;
    const index = overCard(e);
    pointer = null;
    highlight(-1);
    if (index >= 0) buttons[index].click();
  };
  fan.onlostpointercapture = fan.onpointercancel = (e) => {
    if (e.pointerId !== pointer) return;
    pointer = null;
    highlight(-1);
  };
  // The pointerup handler resolves the scrubbed card. Keep keyboard and AT activation native.
  fan.addEventListener(
    "click",
    (e) => {
      if (e.detail > 0) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true,
  );
  fan.onkeydown = (e) => {
    const i = buttons.indexOf(document.activeElement);
    if (i < 0) return;
    if (e.key === "Escape") highlight(-1);
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const next = Math.max(
        0,
        Math.min(buttons.length - 1, i + (e.key === "ArrowLeft" ? -1 : 1)),
      );
      buttons[next].focus();
      highlight(next);
    }
  };
  fan.onfocusout = () => {
    if (pointer === null) highlight(-1);
  };
}
