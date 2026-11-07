import { useEffect, useState } from "react";
import { toLocalDateString } from "@/lib/kanban";

export const useToday = () => {
  const [today, setToday] = useState(() => toLocalDateString(new Date()));

  useEffect(() => {
    let timeout: number;
    const update = () => {
      window.clearTimeout(timeout);
      const now = new Date();
      setToday(toLocalDateString(now));
      const nextMidnight = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1
      );
      timeout = window.setTimeout(update, nextMidnight.getTime() - now.getTime());
    };

    update();
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearTimeout(timeout);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  return today;
};
