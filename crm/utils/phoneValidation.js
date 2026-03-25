// CHANGE: Prevent user from entering their own mobile number
// Centralized phone validation utility to prevent users from using their own numbers

const userPhoneMap = {
  "Arwinder Singh": "9216688993",
  "Paramjeet Singh": "9216040034",
  "Gursewak Singh": "7717300759",
  "Abhayjit Sekhon": "7717300760",
  "Sumit Khushwa": "7717301488",
  "Nikhil Sharma": "6283831303",
  "Vageesh Bhardwaj": "7888697010",
  "Sidhant Oberai": "7814696750",
  "Ram Kumar": "8628800828",
  "Anirban Syam": "6239004162",
  "Harpreet Singh": "7888398428",
  "Kulwinder Singh": "6283362283",
  "Animesh Trivedi": "8360767106",
  "Vaibhav Mishra": "8090858548",
  "Manjit Singh Chowhan": "7717309503",
  "Sukhjinder Pal Singh": "7717300412",
  "Pitamber Sharma": "9903143576",
  "Rohit Kumar Tiwari": "9755242874",
  "Ajay Kumar": "8628800828",
  "Purnendu Kumar": "7717302977",
  "Sahiba": "7009008180",
  "Sahil Gupta": "6283831301",
  "Sunil Kumar Singh": "7888492232",
  "Santosh Kumar": "8877671971",
  "Amarjeet Singh": "7743002541",
  "Priya Sharma": "7888398431",
  "Dinesh Kumar Soni": "7888492227",
  "Suresh Kumar": "7717300413",
  "Utsav Mahesh": "6239703004",
  "Sandeep Sehgal": "6283368239",
  "Mayank Goutam": "7717303620",
  "Leeza Bhagria": "9056802995",
  "J P Sharma": "7888398431",
  "Ekant Yati": "7888697002",
  "Vaibhav Mishra 2": "7888697011",
  "Sahil Kapoor": "9855445670",
  "Ashwani": "9216899880",
  "Shri Kant": "9216988989",
  "Arif Khan": "6283368247",
  "Abhay Pratap Singh": "9557300662",
  "Sabir Khan": "9216688994",
  "Nadeem Khan": "8791738244",
  "Sidhant Prejapati": "7617518444",
  "Sushil Kumar": "9216988993",
  "Bachan Pal": "8288081464",
  "Rakesh Kumar": "7717309502",
  "P S Brar": "9216988990",
  "Vaseem Khan": "9216140040",
  "Varun": "7888492226",
  "Rajeev Kanda": "6283368238",
  "Susheel Kumar": "7009008167",
  "Sunil Kukkar": "7743002542",
  "Surbhi Chugh": "7888492229",
  "Nancy Goyal": "6283362270",
  "Joyti Rani": "9056803504",
  "Mayank Prasad": "7717309501"
};

/**
 * Validates that the provided mobile number is not the logged-in user's own number
 * @param {string} mobileNumber - The mobile number to validate
 * @param {string} username - The logged-in user's username
 * @returns {Object} - { isValid: boolean, message: string }
 */
const validatePhoneNumber = (mobileNumber, username) => {
  if (!mobileNumber || !username) {
    return { isValid: true, message: "" };
  }

  // Normalize the mobile number (remove spaces, dashes, etc.)
  const normalizedInput = mobileNumber.replace(/\D/g, "");
  
  // Get the user's assigned phone number
  const userAssignedNumber = userPhoneMap[username];
  
  if (!userAssignedNumber) {
    // User not in the map, allow any number
    return { isValid: true, message: "" };
  }

  // Check if the input matches the user's own number
  if (normalizedInput === userAssignedNumber) {
    return {
      isValid: false,
      message: "You cannot use your own mobile number as a customer number. Please enter the customer's actual contact number."
    };
  }

  return { isValid: true, message: "" };
};

module.exports = {
  userPhoneMap,
  validatePhoneNumber
};
