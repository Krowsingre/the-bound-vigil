import { fireEvent, render, screen } from "@testing-library/react";
import { PageNumbers } from "./Pagination";

it("the … takes a typed page and goes there", () => {
  const onPage = vi.fn();
  render(<PageNumbers page={0} count={20} onPage={onPage} />);
  fireEvent.click(screen.getByRole("button", { name: "Go to a page" }));
  const box = screen.getByRole("textbox", { name: "Page number, 1 to 20" });
  fireEvent.change(box, { target: { value: "12" } });
  fireEvent.keyDown(box, { key: "Enter" });
  expect(onPage).toHaveBeenCalledWith(11);
  // Past the end goes to the last page; Escape puts the … back.
  fireEvent.click(screen.getByRole("button", { name: "Go to a page" }));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "99" } });
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
  expect(onPage).toHaveBeenLastCalledWith(19);
  fireEvent.click(screen.getByRole("button", { name: "Go to a page" }));
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
  expect(screen.getByRole("button", { name: "Go to a page" })).toBeInTheDocument();
  expect(onPage).toHaveBeenCalledTimes(2);
});
