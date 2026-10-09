import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@tj/ui";
import { SignInForm } from "./SignInForm";

import { SIGN_IN_SHEET_SENT_NOTE, SIGN_IN_TO_EDIT } from "./sign-in-copy";

export { SIGN_IN_SHEET_SENT_NOTE, SIGN_IN_TO_EDIT };

/**
 * Sign-in as a sheet over the page (TEACH-245, UX ruling 109): the same `SignInForm` as `/sign-in`,
 * with the callback set to `redirect` so the teacher comes back to the lesson they were looking at.
 * The page behind stays mounted; closing the sheet leaves it as it was.
 */
export function SignInSheet({
  open,
  onOpenChange,
  redirect,
  title = SIGN_IN_TO_EDIT,
  description = "Your lesson stays here. Once you are signed in it opens again, ready to edit.",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A same-origin path, e.g. `/l/<id>`. */
  redirect: string;
  title?: string;
  description?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" data-sign-in-sheet="" className="gap-5 p-5 sm:p-7">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <SignInForm redirect={redirect} sentNote={SIGN_IN_SHEET_SENT_NOTE} />
      </DialogContent>
    </Dialog>
  );
}
