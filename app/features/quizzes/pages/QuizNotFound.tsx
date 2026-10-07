import type { ReactNode } from 'react';
import { Link } from "react-router";

export function QuizNotFound({ what, eyebrow, back, backLabel }: { what: string; eyebrow: ReactNode; back: string; backLabel: string }) {
  return (
    <>
      <header className="panel__head">
        <span className="panel__eyebrow">{eyebrow}</span>
        <h2>Not found</h2>
      </header>
      <div className="panel__body">
        <div className="empty">
          <div className="empty__icon">?</div>
          <p>{what}</p>
        </div>
        <Link to={back} className="action">
          {backLabel}
        </Link>
      </div>
    </>
  );
}
