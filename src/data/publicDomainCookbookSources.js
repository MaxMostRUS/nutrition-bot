module.exports = [
  {
    id: 'gutenberg-65061-boston-cooking-school',
    title: 'The Boston Cooking-School Cook Book',
    author: 'Fannie Merritt Farmer',
    language: 'en',
    catalogUrl: 'https://www.gutenberg.org/ebooks/65061',
    htmlUrl: 'https://www.gutenberg.org/cache/epub/65061/pg65061-images.html'
  },
  {
    id: 'gutenberg-8870-mejor-cocinera',
    title: 'La Mejor Cocinera, Recetas de Cocina',
    author: 'Calleja',
    language: 'es',
    catalogUrl: 'https://www.gutenberg.org/ebooks/8870',
    htmlUrl: 'https://www.gutenberg.org/cache/epub/8870/pg8870-images.html'
  },
  {
    id: 'gutenberg-42642-cocina-del-tiempo',
    title: 'Cocina del tiempo, ó arte de preparar sabrosos y exquisitos platos',
    author: 'Luis Ruiz Contreras',
    language: 'es',
    catalogUrl: 'https://www.gutenberg.org/ebooks/42642',
    htmlUrl: 'https://www.gutenberg.org/cache/epub/42642/pg42642-images.html'
  },
  {
    id: 'gutenberg-43276-almacen-recetas',
    title: 'Almacen de recetas escogidas y probadas',
    author: 'Anonymous',
    language: 'es',
    catalogUrl: 'https://www.gutenberg.org/ebooks/43276',
    htmlUrl: 'https://www.gutenberg.org/cache/epub/43276/pg43276-images.html'
  }
].map((source) => ({
  ...source,
  sourceType: 'book_project_gutenberg',
  license: 'PUBLIC-DOMAIN-US',
  licenseUrl: source.catalogUrl,
  status: 'candidate',
  parserStatus: 'needs-structured-extraction'
}));
