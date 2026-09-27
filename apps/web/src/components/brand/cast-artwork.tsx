import type { CSSProperties, ReactElement } from "react";
import type { CastKind } from "./cast-rig";

/*
 * The four DayBack characters as the homepage hero draws them (TEACH-252): Slides, Worksheet
 * (`activity`), Plan (`support`) and Check (`answers`). Converted, not redrawn, from the approved
 * hero silhouettes in homepage/src/hero-artwork.mjs: same paths, gradients and ground shadows,
 * with the `.hm-actor` styles from homepage/assets/hero.css as attributes (2px strokes, 3px limbs,
 * the paper drop shadow). Changes, all for the rig or the app's themes:
 * - eyes are ellipses (the homepage rig swaps its circles for ellipses at runtime to blink them);
 * - the ground shadow group is `.ground`, so a hop can thin it;
 * - ids carry a `dayback-cast-` prefix; one cast per page, so they cannot collide;
 * - two inks, because the app has dark themes and the homepage does not: paper, lines and faces keep
 *   the homepage's ink (#344638, `.hm-actor`) on their light paper, and the arms and legs, drawn on
 *   the page, follow `currentColor`.
 * The rig in cast-rig.ts finds the parts by class: body, hero-legs, arm-left, arm-right, eye,
 * mouth, glasses, ground.
 */

const BODY_SHADOW: CSSProperties = { filter: "drop-shadow(1px 2px 1px #716b4824)" };

export const CAST_ARTWORK: Record<CastKind, ReactElement> = {
  slides: (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 300 300"
      className="block w-full overflow-visible"
      stroke="currentColor"
      fill="none"
      strokeWidth={2}
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      <defs>
        <linearGradient id="dayback-cast-slides-paper-0" x1="0%" y1="0%" x2="95%" y2="85%">
          <stop offset="0.0%" stopColor="#f7c55d" />
          <stop offset="50.0%" stopColor="#f5c156" />
          <stop offset="100.0%" stopColor="#f3bd51" />
        </linearGradient>
        <linearGradient id="dayback-cast-slides-paper-1" x1="0%" y1="0%" x2="95%" y2="85%">
          <stop offset="0.0%" stopColor="#fbf6e0" />
          <stop offset="100.0%" stopColor="#f7f1db" />
        </linearGradient>
        <linearGradient id="dayback-cast-slides-paper-2" x1="0%" y1="0%" x2="95%" y2="85%">
          <stop offset="0.0%" stopColor="#e99458" />
          <stop offset="100.0%" stopColor="#e79054" />
        </linearGradient>
        <filter id="dayback-cast-ground-slides" x="-50%" y="-400%" width="200%" height="900%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
        <filter id="dayback-cast-contact-slides" x="-50%" y="-200%" width="200%" height="500%">
          <feGaussianBlur stdDeviation="1.8" />
        </filter>
      </defs>
      <g stroke="none" fill="#756b4d" className="ground">
        <ellipse
          cx="149.5"
          cy="248.5"
          rx="98.5"
          ry="8"
          opacity=".16"
          filter="url(#dayback-cast-ground-slides)"
        />
        <g opacity=".25" filter="url(#dayback-cast-contact-slides)">
          <ellipse cx="64" cy="255" rx="17" ry="2.7" />
          <ellipse cx="225" cy="242" rx="17" ry="2.7" />
        </g>
      </g>
      <path
        className="hero-legs limb"
        d="M82 211 Q77.5 231 73 251 L55 256 M213 205 Q215 222 217 239 L234 242"
        strokeWidth="3"
      />
      <g
        className="body"
        transform="translate(150 235) rotate(0) translate(-150 -235)"
        stroke="#344638"
        style={BODY_SHADOW}
      >
        <g className="arm-left" stroke="currentColor">
          <path className="limb" d="M48 132 Q15 130 8 160" strokeWidth="3" />
          <ellipse
            cx="8"
            cy="160"
            rx="3.6"
            ry="5"
            transform="rotate(27 8 160)"
            fill="currentColor"
            stroke="none"
          />
        </g>
        <g className="arm-right" stroke="currentColor">
          <path className="limb" d="M248 135 Q277 138 284 101" strokeWidth="3" />
          <ellipse
            cx="284"
            cy="101"
            rx="3.8"
            ry="5.5"
            transform="rotate(14 284 101)"
            fill="currentColor"
            stroke="none"
          />
          <path d="m282 100-1-5" strokeWidth="1.7" />
        </g>
        <path d="M40 62 237 53 245 211 45 218Z" fill="url(#dayback-cast-slides-paper-1)" />
        <path d="M47 57 244 49 249 210 51 217Z" fill="url(#dayback-cast-slides-paper-0)" />
        <path d="M53 59 246 52 250 207 55 215Z" />
        <path d="M36 67v141 M78 87l143-5" />
        <ellipse className="eye" cx="115" cy="121" fill="#344638" rx="3" ry="3" stroke="none" />
        <ellipse className="eye" cx="151" cy="120" fill="#344638" rx="3" ry="3" stroke="none" />
        <path className="mouth" d="M123 136q11 10 23-1" />
        <path d="m80 185 30-31 24 16 32-36 51 45Z" fill="url(#dayback-cast-slides-paper-2)" />
        <circle cx="199" cy="107" r="14" fill="#fff3cb" />
      </g>
    </svg>
  ),
  activity: (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 300 300"
      className="block w-full overflow-visible"
      stroke="currentColor"
      fill="none"
      strokeWidth={2}
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      <defs>
        <linearGradient id="dayback-cast-activity-paper-1" x1="0%" y1="0%" x2="95%" y2="85%">
          <stop offset="0.0%" stopColor="#fbf6e0" />
          <stop offset="100.0%" stopColor="#f7f1db" />
        </linearGradient>
        <linearGradient id="dayback-cast-activity-paper-3" x1="0%" y1="0%" x2="95%" y2="85%">
          <stop offset="0.0%" stopColor="#faf7eb" />
          <stop offset="50.0%" stopColor="#f9f6e9" />
          <stop offset="100.0%" stopColor="#f7f4e6" />
        </linearGradient>
        <linearGradient id="dayback-cast-activity-paper-4" x1="0%" y1="0%" x2="95%" y2="85%">
          <stop offset="0.0%" stopColor="#d0dfec" />
          <stop offset="100.0%" stopColor="#c9dae7" />
        </linearGradient>
        <linearGradient id="dayback-cast-activity-paper-5" x1="0%" y1="0%" x2="95%" y2="85%">
          <stop offset="0.0%" stopColor="#cddab0" />
          <stop offset="100.0%" stopColor="#c7d6aa" />
        </linearGradient>
        <filter id="dayback-cast-ground-activity" x="-50%" y="-400%" width="200%" height="900%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
        <filter id="dayback-cast-contact-activity" x="-50%" y="-200%" width="200%" height="500%">
          <feGaussianBlur stdDeviation="1.8" />
        </filter>
      </defs>
      <g stroke="none" fill="#756b4d" className="ground">
        <ellipse
          cx="148.5"
          cy="271.5"
          rx="78.5"
          ry="8"
          opacity=".16"
          filter="url(#dayback-cast-ground-activity)"
        />
        <g opacity=".25" filter="url(#dayback-cast-contact-activity)">
          <ellipse cx="83" cy="270" rx="17" ry="2.7" />
          <ellipse cx="204" cy="273" rx="17" ry="2.7" />
        </g>
      </g>
      <path
        className="hero-legs limb"
        d="M99 229 Q95.5 248 92 267 L74 271 M190 235 Q192.5 252.5 195 270 L213 274"
        strokeWidth="3"
      />
      <g
        className="body"
        transform="translate(150 235) rotate(0) translate(-150 -235)"
        stroke="#344638"
        style={BODY_SHADOW}
      >
        <g className="arm-left" stroke="currentColor">
          <path className="limb" d="M66 143 Q32 145 36 174" strokeWidth="3" />
          <ellipse
            cx="36"
            cy="174"
            rx="3.5"
            ry="5"
            transform="rotate(-16 36 174)"
            fill="currentColor"
            stroke="none"
          />
        </g>
        <g className="arm-right" stroke="currentColor">
          <path className="limb" d="M235 143 Q266 147 272 105" strokeWidth="3" />
          <ellipse
            cx="272"
            cy="105"
            rx="3.8"
            ry="5.4"
            transform="rotate(15 272 105)"
            fill="currentColor"
            stroke="none"
          />
          <path d="m270 104-1-4" strokeWidth="1.7" />
        </g>
        <path d="M71 46 209 51 239 91 226 238 59 230Z" fill="url(#dayback-cast-activity-paper-1)" />
        <path d="M68 43 205 49 235 89 222 236 56 227Z" fill="url(#dayback-cast-activity-paper-3)" />
        <path d="M205 49 200 91 235 89Z" fill="url(#dayback-cast-activity-paper-4)" />
        <path d="M86 79l77 3 M86 92l53 1" />
        <ellipse className="eye" cx="125" cy="114" fill="#344638" rx="3" ry="3" stroke="none" />
        <ellipse className="eye" cx="161" cy="116" fill="#344638" rx="3" ry="3" stroke="none" />
        <path className="mouth" d="M133 130q11 13 22 0" />
        <path d="M92 149 117 150 115 175 89 174Z" fill="url(#dayback-cast-activity-paper-5)" />
        <path d="M133 156l57 2 M133 169l40 1 M91 191l90 4 M91 205l67 3" />
      </g>
    </svg>
  ),
  support: (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 300 300"
      className="block w-full overflow-visible"
      stroke="currentColor"
      fill="none"
      strokeWidth={2}
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      <defs>
        <linearGradient id="dayback-cast-support-paper-1" x1="0%" y1="0%" x2="95%" y2="85%">
          <stop offset="0.0%" stopColor="#fbf6e0" />
          <stop offset="100.0%" stopColor="#f7f1db" />
        </linearGradient>
        <linearGradient id="dayback-cast-support-paper-6" x1="0%" y1="0%" x2="95%" y2="85%">
          <stop offset="0.0%" stopColor="#dbe5c2" />
          <stop offset="50.0%" stopColor="#d8e3bf" />
          <stop offset="100.0%" stopColor="#d2dfb9" />
        </linearGradient>
        <linearGradient id="dayback-cast-support-paper-7" x1="0%" y1="0%" x2="95%" y2="85%">
          <stop offset="0.0%" stopColor="#859973" />
          <stop offset="100.0%" stopColor="#7d926c" />
        </linearGradient>
        <filter id="dayback-cast-ground-support" x="-50%" y="-400%" width="200%" height="900%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
        <filter id="dayback-cast-contact-support" x="-50%" y="-200%" width="200%" height="500%">
          <feGaussianBlur stdDeviation="1.8" />
        </filter>
      </defs>
      <g stroke="none" fill="#756b4d" className="ground">
        <ellipse
          cx="145"
          cy="275.5"
          rx="89"
          ry="8"
          opacity=".16"
          filter="url(#dayback-cast-ground-support)"
        />
        <g opacity=".25" filter="url(#dayback-cast-contact-support)">
          <ellipse cx="69" cy="281" rx="17" ry="2.7" />
          <ellipse cx="211" cy="270" rx="17" ry="2.7" />
        </g>
      </g>
      <path
        className="hero-legs limb"
        d="M90.7877811146455 238.3035033938028 Q85.39389055732275 257.6517516969014 80 277 L59 282 M196.313999093285 220.57732729390295 Q197.6569995466425 243.28866364695148 199 266 L222 270"
        strokeWidth="3"
      />
      <g
        className="body"
        transform="translate(150 235) rotate(-9) translate(-150 -235)"
        stroke="#344638"
        style={BODY_SHADOW}
      >
        <g className="arm-right" stroke="currentColor">
          <path className="limb" d="M238 158 Q259 157 273 131" strokeWidth="3" />
          <ellipse
            cx="273"
            cy="131"
            rx="3.8"
            ry="5.2"
            transform="rotate(31 273 131)"
            fill="currentColor"
            stroke="none"
          />
          <path d="m274 128 5-3" strokeWidth="2.1" />
        </g>
        <path
          d="M43 67 145 63 245 67 246 236 Q192 231 145 233 Q94 234 43 239Z"
          fill="url(#dayback-cast-support-paper-7)"
        />
        <path
          d="M49 62 Q127 54 145 65 Q166 57 240 61 L240 230 Q185 224 145 230 Q103 224 49 233Z"
          fill="url(#dayback-cast-support-paper-1)"
        />
        <path
          d="M53 58 Q128 52 145 63 Q166 56 238 58 L237 225 Q188 220 145 226 Q104 220 53 229Z"
          fill="url(#dayback-cast-support-paper-6)"
        />
        <path d="M145 63V226" />
        <path d="M74 90h51 M74 103h40 M168 88h47 M168 101h36" />
        <ellipse className="eye" cx="116" cy="134" fill="#344638" rx="3" ry="3" stroke="none" />
        <ellipse className="eye" cx="170" cy="134" fill="#344638" rx="3" ry="3" stroke="none" />
        <path className="mouth" d="M130 153q14 11 28-1" />
        <path d="M76 189h42 M171 191h38" />
        <g className="arm-left" stroke="currentColor">
          <path className="limb" d="M49 162 C25 185 45 199 79 172" strokeWidth="3" />
          <ellipse
            cx="79"
            cy="172"
            rx="3.8"
            ry="5.2"
            transform="rotate(35 79 172)"
            fill="currentColor"
            stroke="none"
          />
        </g>
      </g>
    </svg>
  ),
  answers: (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 300 300"
      className="block w-full overflow-visible"
      stroke="currentColor"
      fill="none"
      strokeWidth={2}
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      <defs>
        <linearGradient id="dayback-cast-answers-paper-8" x1="0%" y1="0%" x2="95%" y2="85%">
          <stop offset="0.0%" stopColor="#f1b098" />
          <stop offset="50.0%" stopColor="#efaa92" />
          <stop offset="100.0%" stopColor="#eca68e" />
        </linearGradient>
        <linearGradient id="dayback-cast-answers-paper-9" x1="0%" y1="0%" x2="95%" y2="85%">
          <stop offset="0.0%" stopColor="#d98a72" />
          <stop offset="100.0%" stopColor="#d3836b" />
        </linearGradient>
        <filter id="dayback-cast-ground-answers" x="-50%" y="-400%" width="200%" height="900%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
        <filter id="dayback-cast-contact-answers" x="-50%" y="-200%" width="200%" height="500%">
          <feGaussianBlur stdDeviation="1.8" />
        </filter>
      </defs>
      <g stroke="none" fill="#756b4d" className="ground">
        <ellipse
          cx="160.5"
          cy="278"
          rx="63.5"
          ry="8"
          opacity=".16"
          filter="url(#dayback-cast-ground-answers)"
        />
        <g opacity=".25" filter="url(#dayback-cast-contact-answers)">
          <ellipse cx="110" cy="273" rx="17" ry="2.7" />
          <ellipse cx="201" cy="283" rx="17" ry="2.7" />
        </g>
      </g>
      <path
        className="hero-legs limb"
        d="M115.62649272276917 227.75693452589587 Q117.81324636138459 248.37846726294794 120 269 L101 273 M180.1419925794551 235.67844184723046 Q186.07099628972753 257.33922092361524 192 279 L209 283"
        strokeWidth="3"
      />
      <g
        className="body"
        transform="translate(150 235) rotate(7) translate(-150 -235)"
        stroke="#344638"
        style={BODY_SHADOW}
      >
        <g className="arm-left" stroke="currentColor">
          <path className="limb" d="M77 151 Q50 164 28 135" strokeWidth="3" />
          <ellipse
            cx="28"
            cy="135"
            rx="3.8"
            ry="5.4"
            transform="rotate(-37 28 135)"
            fill="currentColor"
            stroke="none"
          />
          <path d="m26 132-5-3" strokeWidth="1.8" />
        </g>
        <path d="M84 66H224V239H84Z" fill="url(#dayback-cast-answers-paper-9)" />
        <path d="M77 58H217V232H77Z" fill="url(#dayback-cast-answers-paper-8)" />
        <path d="M99 87h83" />
        <g className="glasses">
          <circle cx="125" cy="125" r="14" />
          <circle cx="168" cy="125" r="14" />
          <path d="M139 125h15 M111 125H77 M182 125h35" />
        </g>
        <ellipse className="eye" cx="125" cy="125" fill="#344638" rx="2.6" ry="2.6" stroke="none" />
        <ellipse className="eye" cx="168" cy="125" fill="#344638" rx="2.6" ry="2.6" stroke="none" />
        <path className="mouth" d="M141 149q10 8 19-1" />
        <path d="m120 184 12 11 23-25" strokeWidth="4" />
        <g className="arm-right" stroke="currentColor">
          <path className="limb" d="M217 151 C239 185 218 193 184 163" strokeWidth="3" />
          <ellipse
            cx="184"
            cy="163"
            rx="4"
            ry="5.6"
            transform="rotate(-40 184 163)"
            fill="currentColor"
            stroke="none"
          />
        </g>
      </g>
    </svg>
  ),
};
