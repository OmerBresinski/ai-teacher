import { button, character, href, pageHero, split } from "../components.mjs";

const link = (label, route) =>
  `<a class="info-link" href="${href(route)}">${label}<span aria-hidden="true"> ↗</span></a>`;
const actions = (primary, route, secondary, secondaryRoute) =>
  button(primary, route) +
  (secondary ? button(secondary, secondaryRoute, { secondary: true }) : "");
const page = (route, title, description, body) => ({ route, title, description, body });
const note = (text) => `<p class="info-note">${text}</p>`;
const accessForm = `<form class="info-form" data-preview-form>
  <label for="access-email">Email address</label><input id="access-email" name="email" type="email" autocomplete="email" placeholder="you@example.com" required>
  <button class="button primary info-submit" type="submit">Preview signup <span aria-hidden="true">↗</span></button>
  <p class="info-form-notice">This is a form preview. Your email will not be sent, saved or added to a mailing list.</p>
  <p class="info-form-status" data-form-status role="status"></p>
</form>`;

const faqs = [
  [
    "What does Gather create?",
    "We’re building Gather to create a lesson plan, teaching slides, a worksheet and an answer key from a topic and class details. This website lets you explore prepared samples; live lesson generation is not available here.",
  ],
  [
    "Can I use my own teaching material?",
    "The planned lesson flow starts with a topic, your notes or a resource you have permission to upload. The current preview does not accept uploads. Leave out pupil names and confidential school information.",
  ],
  [
    "Can I edit the lesson?",
    "Teacher editing is central to the planned product: wording, examples and the order of your materials. The sample lessons show the intended structure, rather than a connected editing workspace.",
  ],
  [
    "Can I use PowerPoint?",
    "PowerPoint export and presenting from Gather are planned, alongside downloadable worksheets and separate answers. These export tools are not connected in this preview.",
  ],
  [
    "Does it use AI?",
    "The product is being designed around AI-assisted lesson preparation. The lessons on this website are prepared examples, not live AI results. Teachers should review subject content, answers and suitability before teaching.",
  ],
  [
    "What does Check do?",
    "The sample review demonstrates corrections and remaining issues, such as unclear questions or missing material. Check is intended to help you review a lesson, but it can miss errors and does not replace your judgement.",
  ],
  [
    "Will it suit my subject or curriculum?",
    `Tell us the subject, year group and curriculum you teach. Current support will need to be confirmed before you sign up. ${link("Ask about your subject", "/contact/")}`,
  ],
  [
    "Do pupils need accounts?",
    "Gather is being built for teacher preparation. Pupils use the materials a teacher chooses to present or print.",
  ],
  [
    "Can I use it at school?",
    `Follow your school’s policy on AI tools and teaching resources. Start with the ${link("school information page", "/for-schools/")} to assess the proposed approach.`,
  ],
  [
    "Can I enter information about pupils?",
    "Describe the class’s learning needs in general terms. Do not enter names, individual records, identifiable pupil work or other information that identifies a pupil.",
  ],
  [
    "Can I create lessons in Arabic or Hebrew?",
    "Language support and export formats will need to be confirmed before access opens. Let us know the language and format you need.",
  ],
  [
    "How much does it cost?",
    `Pricing has not been published. ${link("See pricing and availability", "/pricing/")}`,
  ],
];

export default [
  page(
    "/for-schools/",
    "Gather for schools",
    "Explore a complete lesson and the information your school needs to assess Gather for teacher use.",
    pageHero({
      eyebrow: "FOR SCHOOLS",
      title: "A closer look.<br>A considered decision.",
      description:
        "See how the materials work together, and whether the approach fits your teachers.",
      actions: actions(
        "Explore a sample lesson",
        "/examples/",
        "Ask about school use",
        "/contact/",
      ),
    }) +
      split({
        eyebrow: "START WITH THE MATERIALS",
        title: "Follow a lesson all the way through.",
        body:
          "<p>From the learning goal to the explanation, questions and answers. Look at the subject content, the level of challenge and the room for a teacher’s own approach.</p><p>The sample review shows corrections and outstanding issues. Teachers decide what is suitable for their class.</p>" +
          link("Explore the sample", "/examples/"),
        visual: `<div class="info-lesson-map"><span>Learning goal</span><i aria-hidden="true">↓</i><span>Explanation & examples</span><i aria-hidden="true">↓</i><span>Practice & answers</span></div>`,
      }) +
      `<section class="info-school-notes"><div><p class="eyebrow">A CLEAR STARTING POINT</p><h2>Questions worth asking.</h2></div><div class="info-school-list"><article><h3>AI and school information</h3><p>Use class-level descriptions and leave out pupil names and records. Read about the proposed approach to AI and the information needed before school use.</p>${link("AI and your data", "/trust/")}</article><article><h3>What’s available</h3><p>This is a preview for reviewing the concept and prepared examples. School accounts, shared libraries and single sign-on are not currently offered.</p>${link("Ask about school use", "/contact/")}</article></div></section>`,
  ),

  page(
    "/pricing/",
    "Pricing and availability",
    "Find out about access to Gather and updates on pricing.",
    `<div class="info-contained">${pageHero({ eyebrow: "PRICING & AVAILABILITY", title: "Good things<br>take a little preparation.", description: "We’re preparing Gather for teacher testing. Pricing will be published before paid access opens.", character: "support", actions: actions("Get access updates", "/early-access/", "Explore a sample lesson", "/examples/") })}${note("For now, meet the materials in our prepared sample lessons.")}</div>`,
  ),

  page(
    "/about/",
    "About Gather",
    "Why we’re building Gather to help teachers prepare complete, editable lessons.",
    pageHero({
      eyebrow: "WHY GATHER",
      title: "Good company<br>for a good lesson.",
      description: "A little help with the preparation. Plenty of room for the teacher.",
    }) +
      `<section class="info-about"><div class="info-about-art">${character("slides", { className: "info-about-friend" })}${character("support", { className: "info-about-friend" })}</div><div><h2>The parts should work together.</h2><p>Preparing a lesson means getting the explanation, practice and answers to follow the same idea. It means thinking about the class in front of you, too.</p><p>We’re building Gather to help with that preparation: a complete set of materials, with room to change the wording, the examples and the way the lesson runs.</p><p>You choose what reaches your classroom.</p>${link("Explore a sample lesson", "/examples/")}</div></section>`,
  ),

  page(
    "/help/",
    "Questions about Gather",
    "Answers about lesson creation, editing, exports, AI and access to Gather.",
    pageHero({
      eyebrow: "A LITTLE HELP",
      title: "Good questions.",
      description: "About the materials, the making and what’s available so far.",
    }) +
      `<section class="info-faq" aria-label="Frequently asked questions">${faqs.map(([question, answer]) => `<details><summary>${question}<span aria-hidden="true">+</span></summary><div><p>${answer}</p></div></details>`).join("")}</section>` +
      `<div class="info-help-end"><p>Something else on your mind?</p>${link("Get in touch", "/contact/")}</div>`,
  ),

  page(
    "/trust/",
    "AI and your data",
    "Understand the approach to AI in lesson preparation and what to consider before school use.",
    pageHero({
      eyebrow: "AI & YOUR DATA",
      title: "Know what you’re using.",
      description:
        "Gather is being built to help teachers prepare lessons. Teachers choose what reaches their class.",
    }) +
      `<section class="info-principles"><article><span class="info-number">01</span><div><h2>Review before teaching.</h2><p>AI can make mistakes. Check subject facts, worked answers and whether the lesson suits your pupils. Review practical activities under your school’s usual safety process.</p></div></article><article><span class="info-number">02</span><div><h2>Keep pupil information out.</h2><p>Use descriptions such as “Year 7, new to the particle model”. Do not enter pupil names, identifiable pupil work, assessment records or other identifying details.</p><blockquote>“Year 7, new to the particle model.”<small>Useful class context. No identifying information.</small></blockquote></div></article><article><span class="info-number">03</span><div><h2>Understand the data arrangements.</h2><p>Before using a connected service, your school will need published information about data handling, service providers and account controls. Those operational details are not confirmed by this website preview.</p><div class="info-links">${link("Privacy information", "/privacy/")}${link("Service providers", "/service-providers/")}${link("Ask a question", "/contact/")}</div></div></article></section>`,
  ),

  page(
    "/contact/",
    "Contact Gather",
    "Ask about Gather, school use or the proposed service.",
    `<section class="info-contact"><div class="info-contact-copy"><p class="eyebrow">GET IN TOUCH</p><h1>How can<br>we help?</h1><p>Tell us what you need to know. Please leave pupil names and confidential information out of your message.</p>${link("You might find an answer here", "/help/")}</div><form class="info-form" data-preview-form><label for="contact-name">Your name <span>(optional)</span></label><input id="contact-name" name="name" autocomplete="name"><label for="contact-email">Email address</label><input id="contact-email" name="email" type="email" autocomplete="email" required><label for="contact-subject">What can we help with?</label><select id="contact-subject" name="subject"><option>Using Gather</option><option>School use</option><option>Privacy</option><option>Something else</option></select><label for="contact-message">Message</label><textarea id="contact-message" name="message" rows="5" required></textarea><button class="button primary info-submit" type="submit">Preview message <span aria-hidden="true">↗</span></button><p class="info-form-notice">This is a form preview. Your message and contact details will not be sent or saved.</p><p class="info-form-status" data-form-status role="status"></p></form></section>`,
  ),

  page(
    "/early-access/",
    "Get access updates",
    "See how access updates will work when Gather opens for teacher testing.",
    `<section class="info-access"><div><p class="eyebrow">SOMETHING IN THE MAKING</p><h1>Be here<br>for the beginning.</h1><p>Teacher testing is on its way. Access updates will cover when you can try Gather and what it costs.</p><div class="info-access-friend">${character("activity", { className: "info-access-character" })}</div></div><div><h2>A little heads-up.</h2><p>The signup below is a preview of the future access list.</p>${accessForm}<p class="info-privacy-link">${link("Privacy information", "/privacy/")}</p></div></section>`,
  ),

  page(
    "/404/",
    "Page not found",
    "This Gather page could not be found.",
    `<div class="info-contained">${pageHero({ eyebrow: "404 · A MISSING PAGE", title: "This one’s<br>gone wandering.", description: "The link may have changed. You can return home or explore a sample lesson.", character: "activity", actions: actions("Go home", "/", "Explore a sample lesson", "/examples/") })}</div>`,
  ),
];
