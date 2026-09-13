import { contactEmail, href, legalEntity } from "../components.mjs";

const page = (route, title, description, body) => ({ route, title, description, body });
const mail = `<a href="mailto:${contactEmail}">${contactEmail}</a>`;
const updated = "13 September 2026";
const reading = (body) =>
  `<section class="page-hero container"><div><h1>${body.heading}</h1>${body.lead ? `<p class="lead">${body.lead}</p>` : ""}</div></section><section class="section container reading">${body.content}</section>`;
const table = (headings, rows) =>
  `<div class="reading-table"><table><thead><tr>${headings.map((h) => `<th scope="col">${h}</th>`).join("")}</tr></thead><tbody>${rows
    .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`)
    .join("")}</tbody></table></div>`;

const accessibility = page(
  "/accessibility/",
  "Accessibility | DayBack",
  "How DayBack works with a keyboard, visible focus and reduced motion, the standard we build to, and how to report a fault.",
  reading({
    heading: "Accessibility.",
    content: `<p>Every page and every editor control works from the keyboard alone, and focus is always visible where you are.</p>
      <p>If your device is set to reduce motion, DayBack holds still. Where a page moves on its own, a “Pause motion” control stops it.</p>
      <p>We build to WCAG 2.2 AA and test against it. Where a page falls short, tell us and we fix it.</p>
      <p>Tell us what did not work, on which page and with which assistive technology, at ${mail}. A person replies.</p>`,
  }),
);

const privacy = page(
  "/privacy/",
  "Privacy notice | DayBack",
  "What DayBack collects, why, who processes it, where it goes, how long we keep it, and the rights you have over it.",
  reading({
    heading: "Privacy notice.",
    lead: `How ${legalEntity} handles the personal data in DayBack.`,
    content: `
<h2>Who we are</h2>
<p>DayBack is a lesson-preparation tool for teachers, run by ${legalEntity}, a company registered in England and Wales, company number 16451209, registered office 86-90 Paul Street, London EC2A 4NE. We are the data controller for the personal data described here.</p>
<p>If you have a question about your data, or you want to use any of the rights below, email ${mail}. A person reads that address.</p>

<h2>What we collect</h2>
<p><strong>Your email address.</strong> You sign in with a link we email you, so your email address is your account. There is no password.</p>
<p><strong>What you make in DayBack.</strong> The briefs you write (topic, subject, year group, duration, and the optional class context), any files you upload as starting material, and the lessons, slides and worksheets DayBack produces for you. This is your work, and we treat it as yours.</p>
<p><strong>Technical logs, without your content.</strong> Our servers keep structured logs so we can find and fix faults: timestamps, error codes, and the identifiers of a request, job or lesson. <strong>Your briefs, your uploads, the prompts we send to the AI model and the lessons it writes back are never written to our logs.</strong> When we record an AI call we record the model, how long it took, how many tokens it used and what it cost, never the text.</p>
<p><strong>Nothing about your pupils.</strong> See “Pupils” below.</p>
<p>We do not buy personal data, we do not build advertising profiles, and we do not sell anything to anyone.</p>

<h2>Why we use it, and our lawful basis</h2>
<p>Under the UK GDPR we need a lawful basis for each use. Ours are:</p>
${table(
  ["What we use", "Why", "Lawful basis"],
  [
    [
      "Your email address",
      "To sign you in by emailed link, to keep you signed in, and to email you about your account or a fault that affects you",
      "<strong>Contract</strong> (Article 6(1)(b)). We cannot give you an account without it",
    ],
    [
      "Your briefs, uploads, lessons and worksheets",
      "To generate, store, check, edit, present, print and export your teaching materials",
      "<strong>Contract</strong> (Article 6(1)(b)). This is the service you asked for",
    ],
    [
      "Sending a brief to our AI provider",
      "To generate the lesson you asked for",
      "<strong>Contract</strong> (Article 6(1)(b))",
    ],
    [
      "Technical logs, and per-account rate limits",
      "To keep DayBack working, to investigate faults, and to stop abuse or runaway cost",
      "<strong>Legitimate interests</strong> (Article 6(1)(f)). Running a service that stays up and is not abused. Logs hold no lesson content, so the effect on you is minimal",
    ],
    [
      "Page-speed measurements (see the cookie notice)",
      "To see whether pages load quickly enough",
      "<strong>Legitimate interests</strong> (Article 6(1)(f)). The data is aggregated and carries no cookie or identifier",
    ],
    [
      "Answering your email, including a deletion request",
      "To deal with what you asked, and to keep a record that we did",
      "<strong>Legitimate interests</strong> (Article 6(1)(f)), and <strong>legal obligation</strong> (Article 6(1)(c)) where we must keep a record",
    ],
  ],
)}
<p>We do not use your data to train AI models, and neither does our AI provider (see “Who processes your data”).</p>
<p>We rely on legitimate interests only where we have weighed them against your interests and concluded the processing is proportionate. Ask us at ${mail} if you would like the reasoning.</p>

<h2>Who processes your data</h2>
<p>We use a small number of suppliers. They act on our instructions under a written data-processing agreement.</p>
${table(
  ["Processor", "What they do for us", "Where they process it"],
  [
    [
      "Vercel",
      "Hosts the DayBack web app in your browser, and measures page-load speed",
      "Global edge network; static files only",
    ],
    [
      "Railway",
      "Runs our API, our background worker, our Postgres database and the storage bucket that holds your uploaded files and lesson images",
      "EU-West (Amsterdam), Netherlands",
    ],
    [
      "Amazon Web Services (Amazon Bedrock)",
      "Runs the AI models that write your lesson. We use OpenAI GPT-5.6 models through Bedrock",
      "United States (us-east-1)",
    ],
    ["Resend", "Sends your sign-in link and any service email", "European Union region"],
    [
      "Pexels",
      "Supplies the photographs used to illustrate lessons, with the photographer credited",
      "Image search only; no personal data is sent",
    ],
  ],
)}

<h2>International transfers</h2>
<p>Everything we store stays in the European Economic Area: our database, our file storage and our email provider all run in the EU.</p>
<p><strong>One step leaves the UK and the EEA: the AI call.</strong> When you generate a lesson, your brief, and the text of any file you uploaded, is sent to Amazon Bedrock in the United States, which returns the lesson. Nothing is kept there. Amazon Bedrock does not retain the inputs or outputs of an API call and does not use them to train models. We do not enable request logging in our AWS account.</p>
<p>That transfer is made under the UK International Data Transfer Addendum to the EU Standard Contractual Clauses, as part of our agreement with Amazon Web Services. You can ask us for a copy of the safeguards that apply.</p>

<h2>Pupils</h2>
<p><strong>DayBack is for teachers, and we do not want any pupil’s personal data in it.</strong></p>
<p>DayBack asks about your class, not about individuals. You can tell it the class size, how many pupils have SEND or EAL needs, how many are working above or below, and what the class already knows. Those are counts and descriptions, not registers.</p>
<p>The brief also checks what you type and <strong>blocks anything that looks like a name, an email address or an ID number</strong>. That check is a safety net, not a guarantee.</p>
<p><strong>If you think you entered something identifying:</strong> delete it from the brief or the lesson yourself if you can still see it, and email ${mail} telling us which lesson it was. We will remove it from our database, our storage and our backups, and confirm when it is gone. You do not need to explain yourself, and it will not affect your account. If a pupil’s data has been put at risk, tell your school’s data protection lead too. Your school is the controller for pupil data, not us.</p>

<h2>Your rights</h2>
<p>Under the UK GDPR you can ask us to:</p>
<ul>
<li><strong>give you a copy</strong> of the personal data we hold about you, in a portable form;</li>
<li><strong>correct</strong> anything that is wrong;</li>
<li><strong>delete</strong> your account and your content;</li>
<li><strong>restrict</strong> or <strong>object to</strong> what we do with it, including anything we do on the basis of legitimate interests;</li>
<li><strong>explain</strong> a transfer or a lawful basis.</li>
</ul>
<p>To use any of these, email ${mail} from the address you sign in with. We will reply within one month. We will not charge you, and we will not make you use a form.</p>
<p><strong>Deleting or exporting your account today.</strong> DayBack does not yet have a button for this. Until it does, email ${mail} and we will do it by hand: we will export your lessons or delete your account and its content, and confirm when it is done, within 30 days.</p>
<p>If you are not happy with how we have handled your data you can complain to the Information Commissioner’s Office at ico.org.uk, or call 0303 123 1113. We would rather you told us first, so we can put it right.</p>

<h2>How long we keep things</h2>
${table(
  ["What", "How long"],
  [
    [
      "Your account and email address",
      "While your account is open, then 12 months after you last sign in, then deleted",
    ],
    [
      "Your briefs, uploads, lessons and worksheets",
      "While your account is open, or until you delete them. Deleted from backups within 30 days after that",
    ],
    ["Technical logs", "30 days"],
    ["Records of a sign-in email being sent", "30 days at our email provider"],
    ["Emails you send us, and our reply", "24 months"],
    ["Records we must keep by law", "For as long as the law requires"],
  ],
)}
<p>Nothing is kept “just in case”. If you ask us to delete your account, we delete it.</p>

<h2>Changes to this notice</h2>
<p>If we change how we handle your data we will update this page and change the date below. If the change is significant, such as a new processor handling your lesson content, a new purpose, or a change to where the AI call happens, we will email you before it takes effect.</p>
<p><strong>Last updated: ${updated}</strong></p>`,
  }),
);

const terms = page(
  "/terms/",
  "Terms of use | DayBack",
  "The agreement between you and DayBack Ltd: who may use DayBack, what you keep, what the AI output is worth, and how either of us can end it.",
  reading({
    heading: "Terms of use.",
    lead: `The agreement between you and ${legalEntity} for your use of DayBack. By signing in, you accept them.`,
    content: `
<h2>Who may use DayBack</h2>
<p>DayBack is for teachers and other educators, and you must be 18 or over. It is a tool for preparing lessons. It is not for pupils, and pupils should not have accounts.</p>

<h2>Your account</h2>
<p>You sign in with a link we email you. That link is how we know you are you, so treat it like a password: do not forward it, and tell us at ${mail} if you think someone else has used your account. One account is for one person. You are responsible for what happens under your account.</p>

<h2>Your content, and what you let us do with it</h2>
<p>The briefs you write, the files you upload and the lessons you produce are yours. We claim no ownership of them.</p>
<p>To run the service we need your permission to handle them, so you give us a <strong>non-exclusive, worldwide, royalty-free licence to store, copy, adapt and transmit your content for the sole purpose of providing DayBack to you</strong>: generating your lesson, checking it, storing it, showing it to you, and exporting it when you ask. That includes sending your brief to our AI provider, as described in the <a href="${href("/privacy/")}">privacy notice</a>. The licence lasts as long as we hold the content, and ends when you delete it.</p>
<p><strong>We do not use your content to train AI models, and we do not let our suppliers do so.</strong> We will not publish your lessons or show them to another user.</p>

<h2>Our content, and what you may do with it</h2>
<p>The lessons, slides, worksheets and answer keys DayBack generates for you are yours to use in your own teaching: teach from them, print them, hand them to your class, adapt them, share them with colleagues at your school, and export them to PowerPoint, PDF, PNG, Word or JSON. You do not need to credit us.</p>
<p>You may not resell DayBack’s output as a commercial resource product, or present it as your own product for sale.</p>
<p>The DayBack site, software, wording and design remain ours.</p>
<p>Photographs in your lesson come from Pexels and stay under the Pexels licence, with the photographer credited. Keep the credit when you share the lesson.</p>

<h2>What you upload</h2>
<p>You may upload up to three files of your own material as a starting point. <strong>Only upload material you are allowed to use for your own teaching.</strong> Do not upload a published scheme of work, a textbook, an exam paper or anything else you do not have the right to copy, and do not upload anything containing pupils’ personal data. You confirm you have the rights you need for anything you upload, and you are responsible if you do not.</p>
<p>We may remove content, or suspend an account, if we are told in good faith that it infringes someone’s rights.</p>

<h2>Acceptable use</h2>
<p>Do not use DayBack to produce material that is unlawful, hateful, harassing or sexual, or that is unsuitable for the pupils you teach. Do not try to break, overload, scrape or reverse-engineer the service, get into another person’s account, or get round the rate limits we apply to keep it running for everyone. Do not resell access.</p>

<h2>AI output</h2>
<p>DayBack writes lessons with AI models, and AI gets things wrong. It can state a fact that is not true, mark a wrong answer as right, pitch work at the wrong level, or miss something your class needs.</p>
<p><strong>Read what it made before you teach it.</strong> Check the subject content, check the answers, and check that it suits your pupils. Run any practical activity through your school’s usual safety process. We run automatic coherence and quality checks on every lesson and flag what they find, but those checks are not a review and they do not catch everything.</p>
<p><strong>We do not guarantee that the output is accurate, complete, suitable for your class or aligned to any curriculum or specification.</strong> You remain the teacher. The professional judgement is yours.</p>

<h2>Availability and changes</h2>
<p>DayBack is free to use at the moment. It is a new service and we change it often: features may be added, altered or removed, and we may set limits on how much you can generate. We do not promise it will be available at any particular time, and we may take it down for maintenance.</p>
<p><strong>If we ever introduce a paid plan, we will tell you well before it affects you</strong> and you will be able to keep and export everything you have made.</p>
<p>We may change these terms. If a change matters to you we will email you before it takes effect. If you do not accept it, stop using DayBack and ask us to delete your account.</p>

<h2>Our liability</h2>
<p>Nothing in these terms limits our liability for death or personal injury caused by our negligence, for fraud, or for anything else that cannot be limited by law.</p>
<p>Otherwise, and as far as English law allows: DayBack is provided as it is. We give no warranty that it will be uninterrupted, error-free or fit for a particular purpose. <strong>We are not liable for any loss arising from your use of, or reliance on, the lessons DayBack produces</strong>, including a lesson that turned out to be wrong or unsuitable, nor for indirect or consequential loss, loss of profit, loss of goodwill, or the cost of preparing a lesson another way.</p>
<p>Because DayBack is free, <strong>our total liability to you is limited to £100</strong>.</p>

<h2>Ending it</h2>
<p>You can stop using DayBack at any time, and ask us to delete your account by emailing ${mail}.</p>
<p>We may suspend or close your account if you break these terms, if you use DayBack in a way that harms other users or us, or if we stop offering the service. Unless you have seriously broken these terms, we will give you reasonable notice and a chance to export your lessons first.</p>

<h2>Law and courts</h2>
<p>These terms are governed by the law of England and Wales, and the courts of England and Wales have exclusive jurisdiction.</p>

<h2>Contact</h2>
<p>${mail}. ${legalEntity}, 86-90 Paul Street, London EC2A 4NE.</p>
<p><strong>Last updated: ${updated}</strong></p>`,
  }),
);

const cookies = page(
  "/cookies/",
  "Cookie notice | DayBack",
  "DayBack uses one cookie, the one that keeps you signed in. No analytics cookies, no advertising cookies, no third-party cookies.",
  reading({
    heading: "Cookie notice.",
    lead: "DayBack uses one cookie. It is the cookie that keeps you signed in.",
    content: `
${table(
  ["Cookie", "Purpose", "Set by", "Lasts"],
  [
    [
      "<code>tj.session_token</code>",
      "Remembers that you signed in with your emailed link, so you are not asked again on every page",
      "DayBack",
      "7 days, refreshed while you use DayBack",
    ],
  ],
)}
<p>It is set when you follow your sign-in link, it is marked <code>SameSite=Lax</code> so it is not sent from other websites, and it holds nothing except your session. It is essential to the service, so there is no consent banner to click.</p>
<p><strong>No analytics cookies. No advertising cookies. No tracking pixels. No third-party cookies.</strong></p>
<p>We do measure how quickly pages load, using Vercel Speed Insights. It reports Core Web Vitals: how fast the page appeared, how soon it responded, whether it moved about while loading. <strong>It sets no cookie and does not identify you or follow you between sites.</strong></p>
<p><strong>To clear the cookie:</strong> sign out, or clear cookies for this site in your browser settings. You will simply need a new sign-in link next time.</p>
<p>Questions: ${mail}.</p>
<p><strong>Last updated: ${updated}</strong></p>`,
  }),
);

export default [privacy, terms, cookies, accessibility];
