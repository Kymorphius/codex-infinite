(() => {
  const requested = new URLSearchParams(location.search).get("theme");
  const theme = ["light", "dark"].includes(requested)
    ? requested
    : matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  document.documentElement.dataset.theme = theme;
})();

