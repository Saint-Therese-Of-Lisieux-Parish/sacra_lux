module.exports = {
  extends: ["stylelint-config-recommended"],
  rules: {
    // The page styles rely on source order. Reordering rules to satisfy
    // these two rules can change the cascade, and no visual tests guard it.
    "no-descending-specificity": null,
    "no-duplicate-selectors": null
  },
  overrides: [
    {
      files: ["public/*.html"],
      customSyntax: "postcss-html"
    }
  ],
  ignoreFiles: ["node_modules/**", "public/vendor/**", "public/fonts/**"]
};
