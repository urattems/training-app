/** Erreur métier attendue, avec un message destiné à l'utilisateur. */
export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainError';
  }
}
