// Minimal in-app Assistant bus for questions/answers

export class AssistantBus {
  constructor({ onQuestion } = {}) {
    this.onQuestion = onQuestion || (() => {});
  }
  ask(q) { this.onQuestion(q); }
}

