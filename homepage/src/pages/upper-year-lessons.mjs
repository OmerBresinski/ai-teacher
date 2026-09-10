const massDiagram = `<svg class="ex-diagram" viewBox="0 0 560 260" role="img" aria-label="A sealed container and its contents have a total mass of 120 grams before and after a reaction"><g stroke="#293b32" stroke-width="2" fill="#fffdf5"><rect x="42" y="45" width="170" height="125" rx="18"/><rect x="348" y="45" width="170" height="125" rx="18"/><path d="M42 66h170M348 66h170"/><rect x="38" y="181" width="178" height="48" rx="5"/><rect x="344" y="181" width="178" height="48" rx="5"/></g><path d="M54 119h146v39H54Z" fill="#d6e2bd"/><path d="M360 127h146v31H360Z" fill="#efa991"/><g fill="#efa991"><circle cx="94" cy="91" r="7"/><circle cx="150" cy="101" r="7"/><circle cx="178" cy="87" r="7"/></g><g fill="#efa991"><circle cx="388" cy="89" r="7"/><circle cx="440" cy="106" r="7"/><circle cx="479" cy="86" r="7"/></g><path d="M245 111h67m-14-13 14 13-14 13" stroke="#293b32" stroke-width="3" fill="none"/><text x="83" y="29">Before</text><text x="398" y="29">After</text><text x="95" y="213">120 g</text><text x="401" y="213">120 g</text></svg>`;

export const upperYearLessons = {
  "conservation-of-mass": {
    title: "Conservation of mass",
    year: "Year 9",
    subject: "science",
    goal: "Use conservation of mass to explain measurements in closed and open reaction systems.",
    intro:
      "The reading changes. Has matter disappeared? Track what stays inside the measured system and what can leave it.",
    brief:
      "Year 9 science, 40 minutes. Explain conservation of mass in closed and open systems, using supplied measurements and gas-producing reactions. No practical experiment required.",
    diagram: massDiagram,
    plan: [
      [
        "5 min",
        "Predict",
        "Show a sealed container and its contents with a total mass of 120 g. Ask what the balance will read after a reaction inside it.",
      ],
      [
        "10 min",
        "Explain",
        "Atoms rearrange during a chemical reaction. None are created or destroyed. If no matter enters or leaves, total mass stays constant.",
      ],
      [
        "10 min",
        "Compare systems",
        "Contrast a closed system with an open flask that releases gas. Define what is on the balance and what is no longer being measured.",
      ],
      [
        "10 min",
        "Apply",
        "Use the supplied mass readings to calculate missing masses and explain an apparent loss.",
      ],
      [
        "5 min",
        "Exit explanation",
        "Ask pupils to explain how an open flask can lose measured mass without breaking conservation of mass.",
      ],
    ],
    notes:
      "These are illustrative data, not instructions for a practical. Do not seal a gas-producing reaction in a rigid container. If planning a demonstration, use a separately risk-assessed method. Ignore changes below the balance resolution.",
    slides: [
      [
        "What will the balance read?",
        "The sealed container and everything inside it have a total mass of 120 g. A reaction happens. Nothing enters or leaves.",
        massDiagram,
      ],
      [
        "Atoms rearrange. Mass stays.",
        "In a closed system, no matter enters or leaves. The atoms rearrange during the reaction, so the total mass of the container and contents remains 120 g.",
        massDiagram,
      ],
      [
        "A lower reading is not lost matter",
        "An open flask and its contents read 120 g before a reaction and 118 g after. If only gas leaves, 2 g of gas is now outside the measured system.",
        '<div class="ex-big-thought">118 g remaining<br>+ 2 g escaped gas<br>= 120 g</div>',
      ],
      [
        "Account for everything",
        "A reaction uses 12 g of A and 8 g of B. If those are the only reactants, all are used and all products are collected, the total product mass is 20 g.",
        '<div class="ex-big-thought">Total reactant mass<br>= total product mass</div>',
      ],
    ],
    questions: [
      "A closed container and its contents have a total mass of 120 g before a reaction. Nothing enters or leaves. What is the total mass afterwards, and why?",
      "An open flask and its contents read 120 g before a reaction and 118 g after. Only gas has left. What mass of gas escaped? Explain why mass is still conserved.",
      "A reaction uses 12 g of A and 8 g of B, the only reactants. All are used and all products are collected. What is the total mass of the products?",
      "A pupil says, ‘The balance reading fell, so atoms were destroyed.’ Explain what information you would need before accepting their conclusion.",
    ],
    bank: "closed system · open system · atoms · rearrange · gas · measured mass",
    answers: [
      "120 g. Atoms rearrange, but none are created or destroyed, and no matter enters or leaves the measured system.",
      "2 g of gas escaped. The remaining 118 g plus the 2 g outside the flask equals the original 120 g; the balance no longer measures all the matter.",
      "20 g. With all reactants and products accounted for, total product mass equals total reactant mass: 12 g + 8 g.",
      "Find out whether matter could enter or leave, and exactly what was weighed. Escaping gas or lost material can reduce the reading; a lower reading does not show that atoms were destroyed.",
    ],
    reviewSlide: 1,
    reviewTitle: "Name the measured system",
    reviewBefore: "The mass stays the same in every reaction.",
    reviewAfter:
      "The total mass stays the same when no matter enters or leaves the measured system.",
    reviewWhy:
      "Separates conservation of mass from the balance reading for only part of an open system.",
    reviewAttention:
      "Check that pupils distinguish the flask and remaining contents from gas that has escaped into the room.",
    homeSlide: 1,
  },
};
