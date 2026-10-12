function calculateBMR({ weight, height, age, gender }) {
    // gender: "М"/"Ж" (или "M"/"F")
    if (gender.toLowerCase().startsWith('m') || gender.toLowerCase().startsWith('м')) {
      return 10 * weight + 6.25 * height - 5 * age + 5;
    } else {
      return 10 * weight + 6.25 * height - 5 * age - 161;
    }
  }

  function activityFactor(level) {
    switch (level.toLowerCase()) {
      case 'низкий': return 1.2;
      case 'средний': return 1.55;
      case 'высокий': return 1.725;
      default: return 1.2;
    }
  }
  
  function adjustCaloriesForGoal(calories, goal) {
    // goal может быть lose/maintain/gain, а пользователь вводит "Сброс веса"/"Поддержание"/"Набор веса"
    switch (goal) {
      case 'lose':
        return Math.round(calories * 0.8);  // -20%
      case 'gain':
        return Math.round(calories * 1.2);  // +20%
      default:
        return Math.round(calories);
    }
  }

  function calculateMacros(caloriesOrOptions, legacyOptions = {}) {
    const options = typeof caloriesOrOptions === 'object'
      ? caloriesOrOptions
      : { calories: caloriesOrOptions, ...legacyOptions };
    const calories = Number(options.calories);
    const weight = Number(options.weight);
    const goal = options.goal || 'maintain';

    if (!Number.isFinite(calories) || calories <= 0) {
      throw new Error('Invalid calories for macro calculation');
    }

    // Protein and fat are tied to body weight; carbs receive the remaining calories.
    const proteinPerKg = goal === 'lose' ? 1.8 : 1.7;
    const fatPerKg = goal === 'lose' ? 0.7 : goal === 'gain' ? 0.9 : 0.8;
    const protein = Number.isFinite(weight) && weight > 0
      ? Math.round(weight * proteinPerKg)
      : Math.round((calories * 0.30) / 4);
    const fat = Number.isFinite(weight) && weight > 0
      ? Math.round(weight * fatPerKg)
      : Math.round((calories * 0.25) / 9);
    const carbs = Math.max(0, Math.round((calories - protein * 4 - fat * 9) / 4));

    return { protein, fat, carbs };
  }

  module.exports = {
    calculateBMR,
    activityFactor,
    adjustCaloriesForGoal,
    calculateMacros
  };
