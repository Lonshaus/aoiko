class LegacyHostNoticeState {
  dismissed = $state(false);

  dismiss(): void {
    this.dismissed = true;
  }
}

export const legacyHostNotice = new LegacyHostNoticeState();
