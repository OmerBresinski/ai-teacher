import { button, character, cta, href, pageHero } from "../components.mjs";

const page = (route, title, description, body) => ({ route, title, description, body });
const policies = [
  [
    "privacy",
    "Privacy notice",
    "The privacy notice is being prepared.",
    "Before accounts or forms go live, this page needs the operator’s identity, the information processed, purposes, retention periods, rights and contact details.",
  ],
  [
    "terms",
    "Terms of use",
    "Terms are being prepared.",
    "The terms need confirmed operator details, service scope, acceptable use, account conditions and the rules for any paid access.",
  ],
  [
    "cookies",
    "Cookies",
    "Cookie information is being prepared.",
    "This static preview does not set analytics or advertising cookies. A production notice must reflect the services actually deployed and any consent choices required.",
  ],
  [
    "service-providers",
    "Service providers",
    "The provider list is being prepared.",
    "No production processor list has been supplied for this preview. The published list needs confirmed organisations, processing purposes and relevant locations.",
  ],
  [
    "accessibility",
    "Accessibility",
    "Built to be easier to use.",
    "This preview supports keyboard navigation, visible focus, responsive layouts and reduced-motion preferences. It is not an accessibility certification. We’ll publish a fuller statement with known limitations and a working contact route before launch.",
  ],
].map(([slug, title, heading, body]) =>
  page(
    `/${slug}/`,
    `${title} — preview`,
    heading,
    pageHero({ eyebrow: "Preview information", title: heading, description: body }) +
      `<section class="section container reading"><div class="notice"><p>This page records the current preview status. It is not a published production policy.</p></div><p>No form submissions are sent or stored by this preview. Please don’t enter confidential information.</p><div class="actions">${button("AI and your data", "/trust/", { secondary: true })}${button("Contact preview", "/contact/", { secondary: true })}</div></section>`,
  ),
);
const guides = [
  [
    "reviewing-a-lesson",
    "Before you teach",
    "A short review of the explanation, practice and answers.",
    [
      [
        "Start with the learning goal",
        "Read the plan first. Check that the explanation and questions give pupils a chance to work on the same idea.",
      ],
      [
        "Try a question yourself",
        "Work through a worksheet question and compare your reasoning with the answer key. Look for ambiguity or missing information.",
      ],
      [
        "Look at the actual slides",
        "Read diagrams, labels and examples in context. A review flag is a prompt to inspect a material, not a substitute for your judgement.",
      ],
      [
        "Make one change for your class",
        "Change the opening example, add a word bank or adjust the order. Explore the prepared shadow lesson to see those pieces together.",
      ],
    ],
  ],
  [
    "writing-a-brief",
    "A useful starting point",
    "Give the lesson enough context to have a direction.",
    [
      [
        "Name the class and the idea",
        "Include the year group, subject and what you want pupils to understand.",
      ],
      [
        "Say what they already know",
        "Describe prior learning at class level. Leave out pupil names, records and identifying information.",
      ],
      [
        "Make the practical details clear",
        "Mention available time, resources and whether you want discussion, practical work or written practice.",
      ],
      [
        "Read your brief back",
        "Could another teacher understand the learning goal from it? Our prepared sample brief pairs a clear science question with a practical activity and a word bank.",
      ],
    ],
  ],
];
const guidePages = guides.map(([slug, title, description, sections]) =>
  page(
    `/guides/${slug}/`,
    title,
    description,
    pageHero({ eyebrow: "A little preparation", title, description }) +
      `<article class="section container reading">${sections.map(([h, p]) => `<h2>${h}</h2><p>${p}</p>`).join("")}<div class="actions">${button("Explore the shadow lesson", "/examples/shadows/")}</div></article>`,
  ),
);
const guideIndex = page(
  "/guides/",
  "Guides for lesson preparation",
  "Simple starting points for reviewing and adapting a lesson.",
  pageHero({
    eyebrow: "Guides",
    title: "A little help with the preparation.",
    description: "Short, practical notes for working with a lesson.",
  }) +
    `<section class="section container reading">${guides.map(([slug, title, description]) => `<article class="rule"><h2><a href="${href(`/guides/${slug}/`)}">${title}</a></h2><p>${description}</p></article>`).join("")}</section>`,
);
const design = page(
  "/design-system/",
  "Good Company design system",
  "The palette, typography, components and page blocks behind LessonCo.",
  pageHero({
    eyebrow: "Working design system",
    title: "Good company, consistently.",
    description:
      "A small set of reusable parts. Cream paper, green ink and characters with a purpose.",
  }) +
    `<section class="section container"><h2>Colour with a job.</h2><div class="token-grid rule">${[
      ["Cream", "#fcf9ee", "Page foundation"],
      ["Ink", "#293b32", "Text and primary actions"],
      ["Sage", "#e5ecd8", "Support and context"],
      ["Sand", "#f0dfc9", "Closing invitation"],
      ["Yellow", "#f5c054", "Slides personality"],
      ["Salmon", "#efa991", "Answers personality"],
    ]
      .map(
        ([name, hex, role]) =>
          `<div><div class="swatch" style="background:${hex}"></div><h3>${name}</h3><p>${hex} · ${role}</p></div>`,
      )
      .join(
        "",
      )}</div></section><section class="section tone-paper"><div class="container"><p class="eyebrow">One family</p><h2>Gabarito, with room to breathe.</h2><p class="lead">A clear hierarchy, rather than lots of competing sizes.</p><div class="rule"><h3>Display · 44–84 px</h3><p>Section headings · 34–56 px. Body · 16–18 px. Supporting text · 14 px minimum.</p></div><div class="actions">${button("Primary action", "/examples/")}${button("Secondary action", "/how-it-works/", { secondary: true })}</div></div></section><section class="section container"><h2>The block library</h2><div class="block-list rule"><article><h3>Page hero</h3><p>One proposition, a supporting sentence and a useful next step. A character is optional.</p></article><article><h3>Split proof</h3><p>One idea beside a concrete sample. Alternate sides to vary rhythm, not to add decoration.</p></article><article><h3>Material explorer</h3><p>Prepared plan, slides, worksheet, answers and review with one consistent navigation.</p></article><article><h3>Reading page</h3><p>A comfortable column for help, guides and honest availability information.</p></article><article><h3>Closing invitation</h3><p>One relevant action, warm sand background and a single character.</p></article></div></section><section class="section tone-sage"><div class="container split"><div><h2>Personality, with purpose.</h2><p class="lead">Independent ambient rhythms. A signature gesture on hover or focus. Offscreen and reduced-motion handling.</p><p>Use the full team once. Elsewhere, choose the character that belongs with the material.</p></div>${character("support")}</div></section>` +
    cta(),
);
export default [...policies, guideIndex, ...guidePages, design];
