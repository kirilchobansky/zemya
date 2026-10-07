/** A panel with a header and one empty-state message (preparing, nothing due). */
export function QuestionsMessage({ title, text }: { title: string; text: string }) {
  return (
    <>
      <header className="panel__head">
        <span className="panel__eyebrow">Questions</span>
        <h2>{title}</h2>
      </header>
      <div className="panel__body">
        <div className="empty">
          <div className="empty__icon">🎓</div>
          <p>{text}</p>
        </div>
      </div>
    </>
  );
}
