import { Suspense } from "react";
import { ShareView } from "./ShareView";

export default function SharePage() {
  return (
    <Suspense>
      <ShareView />
    </Suspense>
  );
}
