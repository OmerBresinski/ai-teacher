import { appButton, button, contactEmail, href, pageHero } from "../components.mjs";
import { examples } from "../examples-data.mjs";

const page = (route, title, description, body) => ({ route, title, description, body });
const mail = `<a href="mailto:${contactEmail}">${contactEmail}</a>`;
const hasExamples = examples.length > 0;

const faqs = [
  [
    "What does DayBack make?",
    "A whole lesson from one brief: slides with notes for you, a worksheet for the class, and the answer key for that worksheet. The slides and the worksheet are written together, so the practice uses what the slides taught.",
  ],
  [
    "Can I start from my own slides or documents?",
    "Yes. Upload up to three files, PDF, PowerPoint or Word, or paste your text straight in. DayBack works from the words in them, and illustrates with stock photographs rather than your own pictures.",
  ],
  [
    "Can I change what it makes?",
    "All of it. Rewrite an explanation, swap an example, reorder the lesson or add a harder question. Slides and worksheet both open in an editor that saves as you type.",
  ],
  [
    "Can I use it in PowerPoint, or print it?",
    "Lessons export as PowerPoint, PDF or PNG. Worksheets and answer keys export as PDF or Word. You can also present the slides from the browser, or print any of it for the class.",
  ],
  [
    "Which subjects and year groups?",
    "Any subject, Reception to Year 13. You pick the year group and the subject, and the lesson is pitched and timed for that class.",
  ],
  [
    "Is it aligned to the National Curriculum?",
    "You set the year group and the learning objectives, and those are exactly what the slides teach and the worksheet practises. DayBack does not look up National Curriculum objectives for you. The ones you give it are the ones it works to.",
  ],
  [
    "Can it be wrong?",
    "Yes. The checks test whether the lesson holds together, not whether a fact is true, so read the slides and the answer key before you teach them.",
  ],
  [
    "Do you store anything about my pupils?",
    "No. The brief asks about the class and not the children: how big it is, how many pupils have SEND or EAL, what they already know. If you type a name, an email address or an ID number, the brief blocks it.",
  ],
  [
    "How much does it cost?",
    "DayBack is free for teachers right now. Everything you make is yours to keep, edit and export. You’ll hear well ahead of any paid plan.",
  ],
  [
    "Can my school use it?",
    `Accounts are individual today: you sign in as yourself, and your lessons are yours. If your school wants DayBack across a department, write to ${mail}.`,
  ],
  [
    "How do I sign in?",
    "With your email address. DayBack emails you a link, you click it, and you’re in. There is no password.",
  ],
];

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
    "<p>The models are OpenAI’s GPT-5.6 family. We do not call OpenAI directly: every call goes through Amazon Bedrock, which does not retain the text sent to it and does not train on it. Bedrock processes those calls in the United States.</p>",
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
    "<p>Sign-in is a link sent to your email address through Resend, in the EU. There is no password.</p>",
  ],
  [
    "Cookies",
    `<p>One cookie, for your sign-in session. No advertising cookies, and no analytics cookies. We measure page load speed, and nothing about you.</p><p><a href="${href("/cookies/")}">Read the cookie notice</a></p>`,
  ],
  [
    "Read it before you teach it",
    "<p>DayBack checks that a lesson holds together. It cannot check that a fact is true. Read the lesson before your class does.</p>",
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
      `<section class="info-faq" aria-label="Questions teachers ask">${faqs
        .map(
          ([question, answer]) =>
            `<details><summary>${question}<span aria-hidden="true">+</span></summary><div><p>${answer}</p></div></details>`,
        )
        .join("")}</section>` +
      `<div class="info-help-end"><p>Something we haven’t answered? Write to ${mail}.</p></div>`,
  ),

  page(
    "/about/",
    "About | DayBack",
    "DayBack prepares lessons for UK teachers: slides, worksheet and answer key that agree with each other. Built by two founders.",
    pageHero({ title: "Preparation, not teaching." }) +
      `<section class="section container reading">
        <p>DayBack is for the hour between the last bell and the evening you wanted back. You type the class and the topic. It returns the slides, the worksheet and the answer key, written together in one go.</p>
        <p>It does not teach. It is not in the room and it does not decide what your class gets. It prepares the lesson. You teach it.</p>
        <p>The standard we hold it to is coherence: a lesson whose parts agree with each other. The objectives you set are the ones the slides explain and the worksheet practises, every question has an answer, the reading level fits the year group, and the timings add up to the lesson you asked for. Every lesson is checked against that standard before you open it.</p>
        <p>Two founders in the UK, Greg and Omer. We build it and we read every email.</p>
        <div class="actions">${appButton("Create a lesson")}${hasExamples ? button("Open an example lesson", "/examples/", { secondary: true }) : ""}</div>
      </section>`,
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
    `<div class="info-contained">${pageHero({
      title: "That page isn’t here.",
      description: hasExamples
        ? "The link may have changed. The example lessons and the FAQ are both one click away."
        : "The link may have changed. The FAQ is one click away.",
      character: "activity",
      actions:
        button("Go to the homepage", "/") +
        (hasExamples
          ? button("Open an example lesson", "/examples/", { secondary: true })
          : button("Read the FAQ", "/help/", { secondary: true })),
    })}</div>`,
  ),
];
