import { escapeHtml } from "./components.mjs";

// The approved hero silhouettes are independent of the original loading cast.
const artwork = {
  support: `<svg viewBox="0 0 300 300" aria-hidden="true"><defs><linearGradient id="hero-support-paper-1" x1="0%" y1="0%" x2="95%" y2="85%"><stop offset="0.0%" stop-color="#fbf6e0"/><stop offset="100.0%" stop-color="#f7f1db"/></linearGradient><linearGradient id="hero-support-paper-6" x1="0%" y1="0%" x2="95%" y2="85%"><stop offset="0.0%" stop-color="#dbe5c2"/><stop offset="50.0%" stop-color="#d8e3bf"/><stop offset="100.0%" stop-color="#d2dfb9"/></linearGradient><linearGradient id="hero-support-paper-7" x1="0%" y1="0%" x2="95%" y2="85%"><stop offset="0.0%" stop-color="#859973"/><stop offset="100.0%" stop-color="#7d926c"/></linearGradient></defs><g class="body">
  <path class="limb" d="M91 229 80 277 59 282 M198 228 199 266 222 270"/>
  <g class="arm-right"><path class="limb" d="M238 158 Q259 157 273 131"/><ellipse cx="273" cy="131" rx="3.8" ry="5.2" transform="rotate(31 273 131)" fill="currentColor" stroke="none"/><path d="m274 128 5-3" stroke-width="2.1"/></g>
  <path d="M43 67 145 63 245 67 246 236 Q192 231 145 233 Q94 234 43 239Z" fill="url(#hero-support-paper-7)"/>
  <path d="M49 62 Q127 54 145 65 Q166 57 240 61 L240 230 Q185 224 145 230 Q103 224 49 233Z" fill="url(#hero-support-paper-1)"/>
  <path d="M53 58 Q128 52 145 63 Q166 56 238 58 L237 225 Q188 220 145 226 Q104 220 53 229Z" fill="url(#hero-support-paper-6)"/>
  <path d="M145 63V226"/>
  <path d="M74 90h51 M74 103h40 M168 88h47 M168 101h36"/>
  <circle class="eye" cx="116" cy="134" r="3" fill="currentColor"/><circle class="eye" cx="170" cy="134" r="3" fill="currentColor"/>
  <path class="mouth" d="M130 153q14 11 28-1"/>
  <path d="M76 189h42 M171 191h38"/>
  <g class="arm-left"><path class="limb" d="M49 162 C25 185 45 199 79 172"/><ellipse cx="79" cy="172" rx="3.8" ry="5.2" transform="rotate(35 79 172)" fill="currentColor" stroke="none"/></g>
</g></svg>`,
  slides: `<svg viewBox="0 0 300 300" aria-hidden="true"><defs><linearGradient id="hero-slides-paper-0" x1="0%" y1="0%" x2="95%" y2="85%"><stop offset="0.0%" stop-color="#f7c55d"/><stop offset="50.0%" stop-color="#f5c156"/><stop offset="100.0%" stop-color="#f3bd51"/></linearGradient><linearGradient id="hero-slides-paper-1" x1="0%" y1="0%" x2="95%" y2="85%"><stop offset="0.0%" stop-color="#fbf6e0"/><stop offset="100.0%" stop-color="#f7f1db"/></linearGradient><linearGradient id="hero-slides-paper-2" x1="0%" y1="0%" x2="95%" y2="85%"><stop offset="0.0%" stop-color="#e99458"/><stop offset="100.0%" stop-color="#e79054"/></linearGradient></defs><g class="body">
  <path class="limb" d="M82 211 73 251 55 256 M213 205 217 239 234 242"/>
  <g class="arm-left"><path class="limb" d="M48 132 Q15 130 8 160"/><ellipse cx="8" cy="160" rx="3.6" ry="5" transform="rotate(27 8 160)" fill="currentColor" stroke="none"/></g>
  <g class="arm-right"><path class="limb" d="M248 135 Q277 138 284 101"/><ellipse cx="284" cy="101" rx="3.8" ry="5.5" transform="rotate(14 284 101)" fill="currentColor" stroke="none"/><path d="m282 100-1-5" stroke-width="1.7"/></g>
  <path d="M40 62 237 53 245 211 45 218Z" fill="url(#hero-slides-paper-1)"/>
  <path d="M47 57 244 49 249 210 51 217Z" fill="url(#hero-slides-paper-0)"/>
  <path d="M53 59 246 52 250 207 55 215Z"/>
  <path d="M36 67v141 M78 87l143-5"/>
  <circle class="eye" cx="115" cy="121" r="3" fill="currentColor"/><circle class="eye" cx="151" cy="120" r="3" fill="currentColor"/>
  <path class="mouth" d="M123 136q11 10 23-1"/>
  <path d="m80 185 30-31 24 16 32-36 51 45Z" fill="url(#hero-slides-paper-2)"/>
  <circle cx="199" cy="107" r="14" fill="#fff3cb"/>
</g></svg>`,
  activity: `<svg viewBox="0 0 300 300" aria-hidden="true"><defs><linearGradient id="hero-activity-paper-1" x1="0%" y1="0%" x2="95%" y2="85%"><stop offset="0.0%" stop-color="#fbf6e0"/><stop offset="100.0%" stop-color="#f7f1db"/></linearGradient><linearGradient id="hero-activity-paper-3" x1="0%" y1="0%" x2="95%" y2="85%"><stop offset="0.0%" stop-color="#faf7eb"/><stop offset="50.0%" stop-color="#f9f6e9"/><stop offset="100.0%" stop-color="#f7f4e6"/></linearGradient><linearGradient id="hero-activity-paper-4" x1="0%" y1="0%" x2="95%" y2="85%"><stop offset="0.0%" stop-color="#d0dfec"/><stop offset="100.0%" stop-color="#c9dae7"/></linearGradient><linearGradient id="hero-activity-paper-5" x1="0%" y1="0%" x2="95%" y2="85%"><stop offset="0.0%" stop-color="#cddab0"/><stop offset="100.0%" stop-color="#c7d6aa"/></linearGradient></defs><g class="body">
  <path class="limb" d="M99 229 92 267 74 271 M190 235 195 270 213 274"/>
  <g class="arm-left"><path class="limb" d="M66 143 Q32 145 36 174"/><ellipse cx="36" cy="174" rx="3.5" ry="5" transform="rotate(-16 36 174)" fill="currentColor" stroke="none"/></g>
  <g class="arm-right"><path class="limb" d="M235 143 Q266 147 272 105"/><ellipse cx="272" cy="105" rx="3.8" ry="5.4" transform="rotate(15 272 105)" fill="currentColor" stroke="none"/><path d="m270 104-1-4" stroke-width="1.7"/></g>
  <path d="M71 46 209 51 239 91 226 238 59 230Z" fill="url(#hero-activity-paper-1)"/>
  <path d="M68 43 205 49 235 89 222 236 56 227Z" fill="url(#hero-activity-paper-3)"/>
  <path d="M205 49 200 91 235 89Z" fill="url(#hero-activity-paper-4)"/>
  <path d="M86 79l77 3 M86 92l53 1"/>
  <circle class="eye" cx="125" cy="114" r="3" fill="currentColor"/><circle class="eye" cx="161" cy="116" r="3" fill="currentColor"/>
  <path class="mouth" d="M133 130q11 13 22 0"/>
  <path d="M92 149 117 150 115 175 89 174Z" fill="url(#hero-activity-paper-5)"/>
  <path d="M133 156l57 2 M133 169l40 1 M91 191l90 4 M91 205l67 3"/>
</g></svg>`,
  answers: `<svg viewBox="0 0 300 300" aria-hidden="true"><defs><linearGradient id="hero-answers-paper-8" x1="0%" y1="0%" x2="95%" y2="85%"><stop offset="0.0%" stop-color="#f1b098"/><stop offset="50.0%" stop-color="#efaa92"/><stop offset="100.0%" stop-color="#eca68e"/></linearGradient><linearGradient id="hero-answers-paper-9" x1="0%" y1="0%" x2="95%" y2="85%"><stop offset="0.0%" stop-color="#d98a72"/><stop offset="100.0%" stop-color="#d3836b"/></linearGradient></defs><g class="body">
  <path class="limb" d="M115 232 120 269 101 273 M180 232 192 279 209 283"/>
  <g class="arm-left"><path class="limb" d="M77 151 Q50 164 28 135"/><ellipse cx="28" cy="135" rx="3.8" ry="5.4" transform="rotate(-37 28 135)" fill="currentColor" stroke="none"/><path d="m26 132-5-3" stroke-width="1.8"/></g>
  <path d="M84 66H224V239H84Z" fill="url(#hero-answers-paper-9)"/>
  <path d="M77 58H217V232H77Z" fill="url(#hero-answers-paper-8)"/>
  <path d="M99 87h83"/>
  <g class="glasses"><circle cx="125" cy="125" r="14"/><circle cx="168" cy="125" r="14"/><path d="M139 125h15 M111 125H77 M182 125h35"/></g>
  <circle class="eye" cx="125" cy="125" r="2.6" fill="currentColor"/><circle class="eye" cx="168" cy="125" r="2.6" fill="currentColor"/>
  <path class="mouth" d="M141 149q10 8 19-1"/>
  <path d="m120 184 12 11 23-25" stroke-width="4"/>
  <g class="arm-right"><path class="limb" d="M217 151 C239 185 218 193 184 163"/><ellipse cx="184" cy="163" rx="4" ry="5.6" transform="rotate(-40 184 163)" fill="currentColor" stroke="none"/></g>
</g></svg>`,
};

const poses = {
  support: {
    angle: -9,
    face: [130, 153, 144, 164, 158, 152],
    pivots: [
      [49, 162],
      [238, 158],
    ],
    feet: [
      [91, 229, 80, 277, 59, 282],
      [198, 228, 199, 266, 222, 270],
    ],
    shadow: [276, -5],
  },
  slides: {
    angle: 0,
    face: [123, 136, 134, 146, 146, 135],
    pivots: [
      [48, 132],
      [248, 135],
    ],
    feet: [
      [82, 211, 73, 251, 55, 256],
      [213, 205, 217, 239, 234, 242],
    ],
    shadow: [249, -5],
  },
  activity: {
    angle: 0,
    face: [133, 130, 144, 143, 155, 130],
    pivots: [
      [66, 143],
      [235, 143],
    ],
    feet: [
      [99, 229, 92, 267, 74, 271],
      [190, 235, 195, 270, 213, 274],
    ],
    shadow: [274, 1],
  },
  answers: {
    angle: 7,
    face: [141, 149, 151, 157, 160, 148],
    pivots: [
      [77, 151],
      [217, 151],
    ],
    feet: [
      [115, 232, 120, 269, 101, 273],
      [180, 232, 192, 279, 209, 283],
    ],
    shadow: [278, 5],
  },
};

export function heroCharacter(kind, className) {
  const pose = poses[kind];
  const angle = (pose.angle * Math.PI) / 180;
  const legs = pose.feet
    .map(([hx, hy, ax, ay, tx, ty]) => {
      const x = 150 + (hx - 150) * Math.cos(angle) - (hy - 235) * Math.sin(angle);
      const y = 235 + (hx - 150) * Math.sin(angle) + (hy - 235) * Math.cos(angle);
      return `M${x} ${y} Q${(x + ax) / 2} ${(y + ay) / 2} ${ax} ${ay} L${tx} ${ty}`;
    })
    .join(" ");
  const svg = artwork[kind]
    .replace(/<path class="limb" d="[^"]*"\/>/, "")
    .replace(
      '<g class="body">',
      `<path class="hero-legs limb" d="${legs}"/><g class="body" transform="translate(150 235) rotate(${pose.angle}) translate(-150 -235)">`,
    );
  return `<div class="hm-actor hm-${className}" data-hero-actor="${kind}" data-hero-pose="${escapeHtml(JSON.stringify(pose))}" aria-hidden="true">${svg}</div>`;
}
