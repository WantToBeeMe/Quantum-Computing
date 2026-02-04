"""
Helper functions for Jupyter notebook examples
"""

def greet(name):
    """
    A simple greeting function
    
    Args:
        name (str): The name to greet
        
    Returns:
        str: A greeting message
    """
    return f"Hello, {name}! Welcome to Jupyter notebooks!"


def calculate_square(number):
    """
    Calculate the square of a number
    
    Args:
        number (int or float): The number to square
        
    Returns:
        int or float: The square of the input number
    """
    return number ** 2


def fibonacci(n):
    """
    Generate the first n numbers in the Fibonacci sequence
    
    Args:
        n (int): Number of Fibonacci numbers to generate
        
    Returns:
        list: List of Fibonacci numbers
    """
    if n <= 0:
        return []
    elif n == 1:
        return [0]
    elif n == 2:
        return [0, 1]
    
    fib_sequence = [0, 1]
    for i in range(2, n):
        fib_sequence.append(fib_sequence[i-1] + fib_sequence[i-2])
    
    return fib_sequence
