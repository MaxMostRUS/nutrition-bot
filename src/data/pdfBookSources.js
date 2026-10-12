const path = require('path');
const booksDir = process.env.PDF_BOOKS_DIR || '/Users/maxmostovskoy/Documents/Codex/Books';

module.exports = [
  {
    title: 'One-Pot Meals Cookbook',
    filePath: path.join(booksDir, 'One-PotMealsCookbook-June2020.pdf'),
    sourceType: 'pdf_recipe_book',
    tags: ['one-pot', 'healthy', 'va']
  },
  {
    title: 'IIFYM 100 Macro Friendly Recipes',
    filePath: path.join(booksDir, 'IIFYM_100-recipe_ebook.pdf'),
    sourceType: 'pdf_recipe_book',
    tags: ['macro-friendly', 'fitness', 'recipes']
  },
  {
    title: 'Nutritious and Delicious Recipe Booklet',
    filePath: path.join(booksDir, 'Nutritious-and-Delicious-Recipe-Booklet.pdf'),
    sourceType: 'pdf_recipe_book',
    tags: ['healthy', 'recipes']
  },
  {
    title: 'Balanced Menus Recipe Toolkit',
    filePath: path.join(booksDir, 'Balanced_Menus_Recipe_Toolkit_0.pdf'),
    sourceType: 'pdf_recipe_book',
    tags: ['balanced-menus', 'recipes', 'toolkit']
  },
  {
    title: 'KCMH Cookbook',
    filePath: path.join(booksDir, 'KCMH_Cookbook_KT_Final_11-6_NoCrops-compressed.pdf'),
    sourceType: 'pdf_recipe_book',
    tags: ['community-cookbook', 'recipes']
  }
];
