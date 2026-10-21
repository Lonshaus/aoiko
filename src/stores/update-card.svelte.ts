// 右下に固定表示される更新案内カード。解析の完了通知は、カードと重ならないようこの高さぶん上に積む。
class UpdateCard {
  height = $state(0);
  // 表示中かどうかは UpdatePrompt の派生値をそのまま読む。カードが無い環境では null。
  isShown = $state.raw<(() => boolean) | null>(null);

  get offset(): number {
    return this.isShown?.() === true ? this.height : 0;
  }
}

export const updateCard = new UpdateCard();
