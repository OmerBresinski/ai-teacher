import { button, contactEmail, cta, href, pageHero, textLink } from "../components.mjs";
import { examples } from "../examples-data.mjs";

const page = (route, title, description, body) => ({ route, title, description, body });
const mail = `<a href="mailto:${contactEmail}">${contactEmail}</a>`;
const hasExamples = examples.length > 0;

// One FAQ source: /help/ renders all of it, the home page renders the entries marked `home`
// (in the order they appear here).
export const faqs = [
  {
    id: "what",
    question: "What does DayBack make?",
    answer:
      "A whole lesson from one brief: slides with notes for you, a worksheet for the class, and the answer key for that worksheet. The worksheet is written from the same facts as the slides, so the practice uses what the slides taught.",
  },
  {
    id: "subjects",
    home: true,
    question: "Which subjects and year groups?",
    answer:
      "Any subject, Reception to Year 13. You pick the year group and the subject, and the lesson is written for that class.",
  },
  {
    id: "own-material",
    home: true,
    question: "Can I start from my own slides or documents?",
    answer:
      "Yes. Upload up to three files (PDF, PowerPoint or Word), or paste your text straight in. DayBack works from the words in them, and illustrates with stock photographs rather than your own pictures.",
  },
  {
    id: "edit",
    question: "Can I change what it makes?",
    answer:
      "All of it. Rewrite an explanation, swap an example, reorder the lesson or add a harder question. Slides and worksheet both open in an editor that saves as you type.",
  },
  {
    id: "export",
    home: true,
    question: "Can I use it in PowerPoint, or print it?",
    answer:
      "Lessons export as PowerPoint, PDF or PNG. Worksheets and answer keys export as PDF or Word. You can also present the slides from the browser, or print any of it for the class.",
  },
  {
    id: "curriculum",
    question: "Is it aligned to the National Curriculum?",
    answer:
      "You set the year group and the learning objectives, and those are what the slides teach and the worksheet practises. DayBack does not look up National Curriculum objectives for you. The ones you give it are the ones it works to.",
  },
  {
    id: "wrong",
    home: true,
    question: "Can it be wrong?",
    answer:
      "Yes. DayBack checks its facts and its answers before you see them, but a model can still get something wrong. Read the slides and the answer key before you teach them.",
  },
  {
    id: "pupils",
    home: true,
    question: "Do you store anything about my pupils?",
    answer:
      "No. The brief asks about the class and not the children: how big it is, how many pupils have SEND or EAL, what they already know. If you type a name, an email address or an ID number, the brief blocks it.",
  },
  {
    id: "cost",
    home: true,
    question: "How much does it cost?",
    answer:
      "DayBack is free for teachers right now. Everything you make is yours to keep, edit and export. You’ll hear well ahead of any paid plan.",
  },
  {
    id: "schools",
    question: "Can my school use it?",
    answer: `Accounts are individual today: you sign in as yourself, and your lessons are yours. If your school wants DayBack across a department, write to ${mail}.`,
  },
  {
    id: "sign-in",
    question: "How do I sign in?",
    answer:
      "With your email address or your Google account. DayBack emails you a link, you click it, and you’re in; or choose Continue with Google. There is no password.",
  },
];

// The same markup on home and /help/.
export const faqList = (items) =>
  `<div class="info-faq">${items
    .map(
      ({ id, question, answer }) =>
        `<details id="${id}"><summary>${question}<span aria-hidden="true">+</span></summary><div><p>${answer}</p></div></details>`,
    )
    .join("")}</div>`;

const trustSections = [
  [
    "What we do with what you type",
    "<p>Your brief, your uploaded files and your lesson are used for one thing: making and editing that lesson. They are not used to train any model, and they go nowhere beyond the services named on this page.</p>",
  ],
  [
    "No pupil data, by design",
    "<p>The brief asks about the class, not the children: class size band, how many pupils have SEND or EAL or are working above or below, and what they already know. Type a pupil name, an email address or an ID number and the brief blocks it before it is saved. Nothing about an individual pupil belongs in DayBack, and nothing is set up to receive it.</p>",
  ],
  [
    "Which AI, and where it runs",
    "<p>The models are OpenAI’s GPT models. We do not call OpenAI directly: every call goes through Amazon Bedrock, which does not retain the text sent to it and does not train on it. Bedrock processes those calls in the United States.</p>",
  ],
  [
    "Where your lessons live",
    "<p>The application, the database and the files you upload are hosted in the European Union, in Amsterdam. The website you are reading is served from Vercel’s network. The AI call is the one part that leaves the EU, and nothing is kept at the other end.</p>",
  ],
  [
    "What we log",
    "<p>Prompts and lesson content are never written to our logs. We record which model ran, how long it took, what it cost, and error codes when something breaks.</p>",
  ],
  [
    "Sign-in and email",
    "<p>Sign-in is a link sent to your email address through Resend, in the EU, or your Google account. We keep your name, email and profile photo link from Google, never Google’s access keys. There is no password.</p>",
  ],
  [
    "Cookies",
    `<p>Only the cookies that keep you signed in. No advertising cookies, and no analytics cookies. We measure page load speed, and nothing about you.</p><p><a href="${href("/cookies/")}">Read the cookie notice</a></p>`,
  ],
  [
    "Read it before you teach it",
    "<p>DayBack checks that a lesson holds together, and checks its facts and answers. It can still get something wrong. Read the lesson before your class does.</p>",
  ],
];

export default [
  page(
    "/help/",
    "Questions teachers ask | DayBack",
    "What DayBack makes, which subjects and years it covers, what it costs, and what happens to what you type. Answered in plain English.",
    pageHero({
      title: "Questions teachers ask.",
      description: "What DayBack makes, what it costs, and what happens to what you type.",
    }) +
      `<section class="section container reading" aria-label="Questions teachers ask">${faqList(faqs)}<p class="info-help-end">Something we haven’t answered? Write to ${mail}.</p></section>` +
      cta(),
  ),

  page(
    "/about/",
    "About | DayBack",
    "DayBack prepares lessons for UK teachers: slides, worksheet and answer key that agree with each other. Built by two founders.",
    pageHero({ title: "Preparation, not teaching." }) +
      `<section class="section container reading">
        <p>DayBack is for the hour between the last bell and the evening you wanted back. You type the class and the topic. It returns the slides, the worksheet and the answer key, written from the same facts.</p>
        <p>It does not teach. It is not in the room and it does not decide what your class gets. It prepares the lesson. You teach it.</p>
        <p>The standard we hold it to is coherence: a lesson whose parts agree with each other. The objectives you set are the ones the slides explain and the worksheet practises, every question has an answer, and the reading level fits the year group. Every lesson is checked against that standard as it is made.</p>
        <p>Two founders in the UK, Greg and Omer. We build it and we read every email.</p>
      </section>` +
      cta({ secondary: hasExamples ? textLink("See the top lessons", "/examples/") : "" }),
  ),

  page(
    "/trust/",
    "AI and your data | DayBack",
    "Which AI models DayBack uses, where the data sits, why no pupil data goes in, and what is never written to our logs. Plain answers for schools.",
    pageHero({
      title: "AI and your data.",
      description: "What a head of department needs to know before a department uses this.",
    }) +
      `<section class="section container reading">${trustSections
        .map(([title, body]) => `<h2>${title}</h2>${body}`)
        .join("")}</section>`,
  ),

  page(
    "/404/",
    "Page not found | DayBack",
    "This DayBack page could not be found.",
    pageHero({
      title: "That page isn’t here.",
      description: hasExamples
        ? "The link may have changed. The top lessons and the FAQ are both one click away."
        : "The link may have changed. The FAQ is one click away.",
      character: "activity",
      actions:
        button("Go to the homepage", "/") +
        (hasExamples
          ? button("See the top lessons", "/examples/", { secondary: true })
          : button("Read the FAQ", "/help/", { secondary: true })),
    }),
  ),
];
